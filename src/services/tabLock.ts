export type TabLockMode = "writer" | "readonly";

export interface TabLock {
  mode: TabLockMode;
  requestTakeover(): void;
}

const LOCK_NAME = "hypercolor-writer";
export const TAB_LOCK_ACQUIRE_DEBOUNCE_MS = 1000;
const YIELD_WAIT_MS = 1500;
const YIELD_CHANNEL = "hypercolor-writer-yield";
const YIELD_REQUEST_CHANNEL = "hypercolor-writer-yield-request";
const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let startPromise: Promise<TabLock> | null = null;
let mode: TabLockMode = "readonly";
let currentAbort: AbortController | null = null;
const listeners = new Set<(lock: TabLock) => void>();
let beforeYield: () => Promise<void> = async () => undefined;
let stealInFlight = false;
let takeoverRefreshPending = false;
let acquireTimer: ReturnType<typeof setTimeout> | null = null;
let acquireGeneration = 0;
let yieldReqChannel: BroadcastChannel | null = null;

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
  };
  host.__hypercolorTabLockMode = () => mode;
  host.__hypercolorEnsureWriter = () => ensureWriter();
  host.__hypercolorRequestTakeover = () => requestTakeover();
  host.__hypercolorAbortWriterLock = () => {
    currentAbort?.abort();
  };
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

function postYielded(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(YIELD_CHANNEL);
    channel.postMessage({ type: "yielded", from: tabId });
    channel.close();
  } catch {
    /* ignore */
  }
}

function postYieldRequest(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(YIELD_REQUEST_CHANNEL);
    channel.postMessage({ type: "yield", from: tabId });
    channel.close();
  } catch {
    /* ignore */
  }
}

function installYieldRequestListener(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    yieldReqChannel?.close();
  } catch {
    /* ignore */
  }
  try {
    const channel = new BroadcastChannel(YIELD_REQUEST_CHANNEL);
    yieldReqChannel = channel;
    channel.onmessage = (event: MessageEvent<{ from?: string }>) => {
      if (event.data?.from === tabId) return;
      if (mode === "writer") currentAbort?.abort();
    };
  } catch {
    /* ignore */
  }
}

export async function waitForPeerWriterYield(timeoutMs = YIELD_WAIT_MS): Promise<void> {
  if (mode === "writer" || !stealInFlight || typeof BroadcastChannel === "undefined") {
    stealInFlight = false;
    return;
  }
  stealInFlight = false;
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        channel.close();
      } catch {
        /* ignore */
      }
      resolve();
    };
    const channel = new BroadcastChannel(YIELD_CHANNEL);
    const timer = setTimeout(done, timeoutMs);
    channel.onmessage = () => done();
  });
}

function becomeReadonly(): void {
  if (mode === "readonly") return;
  mode = "readonly";
  emit();
}

async function flushThenReadonly(): Promise<void> {
  try {
    await beforeYield();
  } catch {
    /* generation guard refuses a late stale put */
  }
  becomeReadonly();
  postYielded();
}

function tryAcquire(options: { ifAvailable?: boolean; steal?: boolean }): Promise<void> {
  if (!hasWebLocks()) {
    mode = "writer";
    emit();
    return Promise.resolve();
  }

  currentAbort?.abort();
  const ac = new AbortController();
  currentAbort = ac;

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
        LOCK_NAME,
        requestOptions,
        async (lock) => {
          if (!lock) {
            mode = "readonly";
            emit();
            done();
            return;
          }
          mode = "writer";
          emit();
          done();
          await holdUntil(ac.signal);
          await flushThenReadonly();
        },
      )
      .catch(() => {
        void flushThenReadonly().finally(done);
      });
  });
}

function isVisibleDocument(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

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
    if (mode === "writer") currentAbort?.abort();
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
  installE2eHooks();
  if (startPromise) return startPromise;

  startPromise = (async () => {
    if (!hasWebLocks()) {
      mode = "writer";
      emit();
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

export function shouldPersistWrites(): boolean {
  if (!hasWebLocks()) return true;
  if (!startPromise) return true;
  return mode === "writer";
}

export function subscribeTabLock(listener: (lock: TabLock) => void): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

function isWriterNow(): boolean {
  return mode === "writer";
}

async function runTakeover(): Promise<void> {
  if (!hasWebLocks()) {
    mode = "writer";
    emit();
    return;
  }
  if (isWriterNow()) return;
  await tryAcquire({ ifAvailable: true });
  if (isWriterNow()) return;
  stealInFlight = true;
  takeoverRefreshPending = true;
  postYieldRequest();
  void tryAcquire({ steal: true });
  await waitForPeerWriterYield();
  if (isWriterNow()) return;
  await tryAcquire({ ifAvailable: true });
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
  if (mode === "writer") return snapshot();
  await runTakeover();
  return snapshot();
}

export async function ensureWriter(): Promise<TabLock> {
  await initTabLock();
  if (mode === "writer") return snapshot();
  return requestTakeoverAndWait();
}

export function setBeforeWriterYield(fn: () => Promise<void>): void {
  beforeYield = fn;
}

export function resetTabLockForTests(): void {
  currentAbort?.abort();
  currentAbort = null;
  startPromise = null;
  mode = "readonly";
  stealInFlight = false;
  takeoverRefreshPending = false;
  if (acquireTimer !== null) {
    clearTimeout(acquireTimer);
    acquireTimer = null;
  }
  acquireGeneration += 1;
  try {
    yieldReqChannel?.close();
  } catch {
    /* ignore */
  }
  yieldReqChannel = null;
  emit();
}
