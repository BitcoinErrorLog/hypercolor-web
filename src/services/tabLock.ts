export type TabLockMode = "writer" | "readonly";

export interface TabLock {
  mode: TabLockMode;
  requestTakeover(): void;
}

/** Unsigned tabs share this scope so they cannot steal an identity's writer lock. */
export const TAB_LOCK_UNSIGNED_SCOPE = "unsigned";
export const TAB_LOCK_ACQUIRE_DEBOUNCE_MS = 1000;
export const YIELD_WAIT_MS = 1500;
export const WRITER_CRITICAL_SECTION_MAX_MS = 30_000;
export const YIELD_REQUEST_MIN_INTERVAL_MS = 1000;

const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let ownerScope = TAB_LOCK_UNSIGNED_SCOPE;
let startPromise: Promise<TabLock> | null = null;
let mode: TabLockMode = "readonly";
let yielding = false;
let takeoverInProgress = false;
let currentAbort: AbortController | null = null;
let pendingStealAbort: AbortController | null = null;
const listeners = new Set<(lock: TabLock) => void>();
let beforeYield: () => Promise<void> = async () => undefined;
let takeoverRefreshPending = false;
let acquireTimer: ReturnType<typeof setTimeout> | null = null;
let acquireGeneration = 0;
let yieldReqChannel: BroadcastChannel | null = null;
let claimChannel: BroadcastChannel | null = null;
let yieldedChannel: BroadcastChannel | null = null;
let criticalDepth = 0;
let deferredYield = false;
let criticalTimer: ReturnType<typeof setTimeout> | null = null;
const yieldRequestSeenAt = new Map<string, number>();
let writerSurfaceReady = true;

export class TabLockWriterError extends Error {
  readonly name = "TabLockWriterError";
  constructor(message = "Could not become the writer tab.") {
    super(message);
  }
}

function lockName(): string {
  return `hypercolor-writer:${ownerScope}`;
}

function yieldChannelName(): string {
  return `hypercolor-writer-yield:${ownerScope}`;
}

function yieldRequestChannelName(): string {
  return `hypercolor-writer-yield-request:${ownerScope}`;
}

function claimChannelName(): string {
  return `hypercolor-writer-claim:${ownerScope}`;
}

function snapshot(): TabLock {
  return {
    mode,
    requestTakeover,
  };
}

function installE2eHooks(): void {
  if (
    typeof window === "undefined" ||
    typeof __HYPERCOLOR_E2E_HARNESS__ === "undefined" ||
    !__HYPERCOLOR_E2E_HARNESS__
  ) {
    return;
  }
  const host = window as Window & {
    __hypercolorTabLockMode?: () => string;
    __hypercolorEnsureWriter?: () => Promise<TabLock>;
    __hypercolorRequestTakeover?: () => void;
    __hypercolorAbortWriterLock?: () => void;
    __hypercolorTabLockTrace?: string[];
    __hypercolorIsYielding?: () => boolean;
    __hypercolorTakeoverInProgress?: () => boolean;
  };
  host.__hypercolorTabLockMode = () => mode;
  host.__hypercolorEnsureWriter = () => ensureWriter();
  host.__hypercolorRequestTakeover = () => requestTakeover();
  host.__hypercolorAbortWriterLock = () => {
    requestWriterAbort();
  };
  host.__hypercolorIsYielding = () => yielding;
  host.__hypercolorTakeoverInProgress = () => takeoverInProgress;
  if (!host.__hypercolorTabLockTrace) host.__hypercolorTabLockTrace = [];
}

function trace(event: string): void {
  if (typeof window === "undefined") return;
  const host = window as Window & { __hypercolorTabLockTrace?: string[] };
  host.__hypercolorTabLockTrace?.push(event);
}

function emit(): void {
  const lock = snapshot();
  for (const listener of listeners) listener(lock);
  installE2eHooks();
}

function hasWebLocks(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.locks &&
    typeof navigator.locks.request === "function"
  );
}

function holdUntil(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function postChannel(name: string, payload: Record<string, string>): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(name);
    channel.postMessage(payload);
    channel.close();
  } catch {
    /* ignore */
  }
}

function postYielded(): void {
  postChannel(yieldChannelName(), { type: "yielded", from: tabId });
  trace("posted-yielded");
}

function postYieldRequest(): void {
  postChannel(yieldRequestChannelName(), { type: "yield", from: tabId });
  trace("posted-yield-request");
}

function postWriterClaim(): void {
  postChannel(claimChannelName(), {
    type: "claim",
    from: tabId,
  });
  trace("posted-claim");
}

function rateLimitYieldFrom(from: string): boolean {
  const now = Date.now();
  const last = yieldRequestSeenAt.get(from) ?? 0;
  if (now - last < YIELD_REQUEST_MIN_INTERVAL_MS) return false;
  yieldRequestSeenAt.set(from, now);
  return true;
}

function requestWriterAbort(): void {
  if (criticalDepth > 0) {
    deferredYield = true;
    return;
  }
  beginYielding();
  currentAbort?.abort();
}

function beginYielding(): void {
  if (mode !== "writer") return;
  yielding = true;
  emit();
}

function closeChannel(channel: BroadcastChannel | null): void {
  try {
    channel?.close();
  } catch {
    /* ignore */
  }
}

function installYieldRequestListener(): void {
  if (typeof BroadcastChannel === "undefined") return;
  closeChannel(yieldReqChannel);
  try {
    const channel = new BroadcastChannel(yieldRequestChannelName());
    yieldReqChannel = channel;
    channel.onmessage = (event: MessageEvent<{ type?: string; from?: string }>) => {
      const data = event.data;
      if (data?.type !== "yield") return;
      const from = data.from;
      if (typeof from !== "string" || from.length === 0 || from === tabId) return;
      if (!rateLimitYieldFrom(from)) return;
      if (mode === "writer") requestWriterAbort();
    };
  } catch {
    /* ignore */
  }
}

function installClaimListener(): void {
  if (typeof BroadcastChannel === "undefined") return;
  closeChannel(claimChannel);
  try {
    const channel = new BroadcastChannel(claimChannelName());
    claimChannel = channel;
    channel.onmessage = (event: MessageEvent<{ type?: string; from?: string }>) => {
      const data = event.data;
      if (data?.type !== "claim") return;
      const from = data.from;
      if (typeof from !== "string" || from.length === 0 || from === tabId) return;
      if (!rateLimitYieldFrom(`claim:${from}`)) return;
      if (mode === "writer" || yielding) {
        abortPendingSteal();
        requestWriterAbort();
        trace("claim-as-yield-request");
      }
    };
  } catch {
    /* ignore */
  }
}

function installYieldedListener(): void {
  if (typeof BroadcastChannel === "undefined") return;
  closeChannel(yieldedChannel);
  try {
    yieldedChannel = new BroadcastChannel(yieldChannelName());
  } catch {
    yieldedChannel = null;
  }
}

/**
 * Wait for a peer `yielded` (type + from checked). Does not early-return on
 * `mode === "writer"` — callers that already hold the lock should not call this.
 */
export async function waitForPeerWriterYield(timeoutMs = YIELD_WAIT_MS): Promise<void> {
  if (typeof BroadcastChannel === "undefined") {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    });
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const channel = yieldedChannel ?? new BroadcastChannel(yieldChannelName());
    const owned = yieldedChannel == null;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.removeEventListener("message", onMessage as EventListener);
      if (owned) closeChannel(channel);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    const onMessage = (event: MessageEvent<{ type?: string; from?: string }>) => {
      const data = event.data;
      if (data?.type !== "yielded") return;
      if (typeof data.from !== "string" || data.from === tabId) return;
      done();
    };
    channel.addEventListener("message", onMessage as EventListener);
  });
}

function becomeReadonly(): void {
  yielding = false;
  if (mode === "readonly") {
    emit();
    return;
  }
  mode = "readonly";
  emit();
}

async function flushThenReadonly(): Promise<void> {
  beginYielding();
  try {
    await beforeYield();
  } catch {
    /* generation guard refuses a late stale put */
  }
  becomeReadonly();
  postYielded();
}

function abortPendingSteal(): void {
  try {
    pendingStealAbort?.abort();
  } catch {
    /* ignore */
  }
  pendingStealAbort = null;
}

function tryAcquire(options: {
  ifAvailable?: boolean;
  steal?: boolean;
  stealAbort?: AbortController;
}): Promise<void> {
  if (!hasWebLocks()) {
    mode = "writer";
    yielding = false;
    emit();
    postWriterClaim();
    return Promise.resolve();
  }

  if (!options.steal) {
    currentAbort?.abort();
  }
  const ac = options.stealAbort ?? new AbortController();
  if (options.steal) pendingStealAbort = ac;
  else currentAbort = ac;

  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const requestOptions: LockOptions = options.ifAvailable
      ? { mode: "exclusive", ifAvailable: true }
      : { mode: "exclusive", steal: options.steal, signal: ac.signal };

    void navigator.locks
      .request(
        lockName(),
        requestOptions,
        async (lock) => {
          if (!lock) {
            if (!options.steal) {
              mode = "readonly";
              emit();
            }
            done();
            return;
          }
          if (options.steal) {
            pendingStealAbort = null;
            currentAbort = ac;
          }
          yielding = false;
          mode = "writer";
          emit();
          postWriterClaim();
          done();
          await holdUntil(ac.signal);
          await flushThenReadonly();
        },
      )
      .catch(() => {
        if (options.steal && ac.signal.aborted) {
          done();
          return;
        }
        void flushThenReadonly().finally(done);
      });
  });
}

function isVisibleDocument(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * Auto-acquire on visible focus after TAB_LOCK_ACQUIRE_DEBOUNCE_MS.
 * Write-intent-only would leave a focused tab readonly until the first mutation;
 * the product rule is that the focused tab is the writer. Cost is one
 * export+hydrate per focus switch, bounded by the debounce, inbound yield
 * rate-limit, and the writer critical section.
 */
function scheduleAutoAcquire(): void {
  if (acquireTimer !== null) clearTimeout(acquireTimer);
  const gen = ++acquireGeneration;
  acquireTimer = setTimeout(() => {
    acquireTimer = null;
    if (gen !== acquireGeneration) return;
    if (!isVisibleDocument()) return;
    if (mode === "writer") return;
    void requestTakeoverAndWait();
  }, TAB_LOCK_ACQUIRE_DEBOUNCE_MS);
}

function onVisibilityOrFocus(event: Event): void {
  if (event.type === "visibilitychange" && !isVisibleDocument()) {
    if (mode === "writer") requestWriterAbort();
    return;
  }
  if (!isVisibleDocument()) return;
  if (mode === "writer") return;
  scheduleAutoAcquire();
}

function installAutoAcquire(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const host = window as Window & { __hcTabLockAuto?: AbortController };
  host.__hcTabLockAuto?.abort();
  const ac = new AbortController();
  host.__hcTabLockAuto = ac;
  document.addEventListener("visibilitychange", onVisibilityOrFocus, { signal: ac.signal });
  window.addEventListener("focus", onVisibilityOrFocus, { signal: ac.signal });
}

export async function initTabLock(): Promise<TabLock> {
  installAutoAcquire();
  installYieldRequestListener();
  installClaimListener();
  installYieldedListener();
  installE2eHooks();
  if (startPromise) return startPromise;

  startPromise = (async () => {
    if (!hasWebLocks()) {
      mode = "writer";
      emit();
      postWriterClaim();
      return snapshot();
    }
    await tryAcquire({ ifAvailable: true });
    return snapshot();
  })();

  return startPromise;
}

export function getTabLock(): TabLock {
  return snapshot();
}

export function getTabLockOwnerScope(): string {
  return ownerScope;
}

export function isYieldingTab(): boolean {
  return yielding;
}

export function isTakeoverInProgress(): boolean {
  return takeoverInProgress;
}

export function isWriterSurfaceReady(): boolean {
  return writerSurfaceReady;
}

export function markWriterSurfaceReady(): void {
  writerSurfaceReady = true;
}

export function isWriterCriticalSectionHeld(): boolean {
  return criticalDepth > 0;
}

export function hasWriterLock(): boolean {
  return isWriterNow();
}

export function shouldPersistWrites(): boolean {
  if (!hasWebLocks()) return true;
  if (!startPromise) return true;
  return mode === "writer" && !yielding && writerSurfaceReady;
}

export function subscribeTabLock(listener: (lock: TabLock) => void): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

function isWriterNow(): boolean {
  return mode === "writer" && !yielding;
}

function armTakeoverRefresh(): void {
  takeoverRefreshPending = true;
  writerSurfaceReady = false;
}

export function assertWriter(context: string): void {
  if (isWriterNow()) return;
  throw new TabLockWriterError(`Writer lock lost during ${context}.`);
}

export function enterWriterCriticalSection(): void {
  criticalDepth += 1;
  if (criticalTimer !== null) clearTimeout(criticalTimer);
  criticalTimer = setTimeout(() => {
    criticalTimer = null;
    criticalDepth = 0;
    if (deferredYield) {
      deferredYield = false;
      requestWriterAbort();
    }
  }, WRITER_CRITICAL_SECTION_MAX_MS);
}

export function exitWriterCriticalSection(): void {
  criticalDepth = Math.max(0, criticalDepth - 1);
  if (criticalDepth > 0) return;
  if (criticalTimer !== null) {
    clearTimeout(criticalTimer);
    criticalTimer = null;
  }
  if (deferredYield) {
    deferredYield = false;
    requestWriterAbort();
  }
}

async function runTakeover(): Promise<void> {
  if (!hasWebLocks()) {
    if (!isWriterNow()) armTakeoverRefresh();
    mode = "writer";
    yielding = false;
    emit();
    postWriterClaim();
    return;
  }
  if (isWriterNow()) return;
  armTakeoverRefresh();
  await tryAcquire({ ifAvailable: true });
  if (isWriterNow()) return;

  const canCoordinate = typeof BroadcastChannel !== "undefined";
  takeoverInProgress = true;
  emit();

  const wait = waitForPeerWriterYield();
  if (canCoordinate) postYieldRequest();
  await wait;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await tryAcquire({ ifAvailable: true });
    if (isWriterNow()) {
      abortPendingSteal();
      takeoverInProgress = false;
      emit();
      return;
    }
    await Promise.resolve();
  }

  if (!canCoordinate) {
    abortPendingSteal();
    takeoverInProgress = false;
    writerSurfaceReady = true;
    emit();
    return;
  }

  const stealAbort = new AbortController();
  pendingStealAbort = stealAbort;
  await tryAcquire({ steal: true, stealAbort });
  if (!isWriterNow()) {
    abortPendingSteal();
    writerSurfaceReady = true;
  } else {
    await waitForPeerWriterYield(YIELD_WAIT_MS);
  }
  takeoverInProgress = false;
  emit();
}

export function requestTakeover(): void {
  void runTakeover();
}

export function consumeTakeoverRefresh(): boolean {
  const pending = takeoverRefreshPending;
  takeoverRefreshPending = false;
  return pending;
}

export async function requestTakeoverAndWait(): Promise<TabLock> {
  if (isWriterNow()) return snapshot();
  await runTakeover();
  return snapshot();
}

export async function ensureWriter(): Promise<TabLock> {
  await initTabLock();
  if (isWriterNow()) return snapshot();
  await requestTakeoverAndWait();
  if (!isWriterNow()) {
    throw new TabLockWriterError();
  }
  return snapshot();
}

/** Switch owner scope, then become writer, then enter the critical section. */
export async function acquireScopedWriter(pubky: string): Promise<void> {
  setTabLockOwner(pubky);
  await ensureWriter();
  enterWriterCriticalSection();
  assertWriter("acquireScopedWriter");
}

export function setBeforeWriterYield(fn: () => Promise<void>): void {
  beforeYield = fn;
}

/**
 * Namespace lock + BroadcastChannel by owner pubky. Unsigned tabs stay on the
 * `unsigned` scope so a signed-in tab cannot be stolen by a pre-auth tab.
 */
export function setTabLockOwner(pubky: string | null): void {
  const next = pubky && pubky.length > 0 ? pubky : TAB_LOCK_UNSIGNED_SCOPE;
  if (next === ownerScope) return;
  if (criticalDepth > 0) {
    throw new TabLockWriterError(
      `Cannot change tab lock owner to ${next} while a writer critical section is held.`,
    );
  }
  abortPendingSteal();
  currentAbort?.abort();
  ownerScope = next;
  startPromise = null;
  mode = "readonly";
  yielding = false;
  takeoverInProgress = false;
  takeoverRefreshPending = false;
  writerSurfaceReady = true;
  installYieldRequestListener();
  installClaimListener();
  installYieldedListener();
  emit();
}

export function setTabLockModeForTests(next: TabLockMode): void {
  mode = next;
  yielding = false;
  emit();
}

export function setYieldingForTests(next: boolean): void {
  yielding = next;
}

export function resetTabLockForTests(): void {
  abortPendingSteal();
  currentAbort?.abort();
  currentAbort = null;
  startPromise = null;
  mode = "readonly";
  yielding = false;
  takeoverInProgress = false;
  takeoverRefreshPending = false;
  criticalDepth = 0;
  deferredYield = false;
  writerSurfaceReady = true;
  ownerScope = TAB_LOCK_UNSIGNED_SCOPE;
  yieldRequestSeenAt.clear();
  if (criticalTimer !== null) {
    clearTimeout(criticalTimer);
    criticalTimer = null;
  }
  if (acquireTimer !== null) {
    clearTimeout(acquireTimer);
    acquireTimer = null;
  }
  acquireGeneration += 1;
  closeChannel(yieldReqChannel);
  closeChannel(claimChannel);
  closeChannel(yieldedChannel);
  yieldReqChannel = null;
  claimChannel = null;
  yieldedChannel = null;
  emit();
}
