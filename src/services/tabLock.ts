export type TabLockMode = "writer" | "readonly";

export interface TabLock {
  mode: TabLockMode;
  requestTakeover(): void;
}

const LOCK_NAME = "hypercolor-writer";

let startPromise: Promise<TabLock> | null = null;
let mode: TabLockMode = "readonly";
let currentAbort: AbortController | null = null;
const listeners = new Set<(lock: TabLock) => void>();

function snapshot(): TabLock {
  return {
    mode,
    requestTakeover,
  };
}

function emit(): void {
  const lock = snapshot();
  for (const listener of listeners) listener(lock);
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

function becomeReadonly(): void {
  if (mode === "readonly") return;
  mode = "readonly";
  emit();
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

    // Chromium rejects ifAvailable + signal together (NotSupportedError).
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
          becomeReadonly();
        },
      )
      .catch(() => {
        becomeReadonly();
        done();
      });
  });
}

/**
 * First caller tries to become the writer (`ifAvailable`). Later tabs stay
 * readonly until `requestTakeover()` steals the lock.
 *
 * If `navigator.locks` is missing, this tab is the writer (single-tab
 * fallback). A second tab in that browser cannot coordinate; both would
 * believe they are writers. Documented in README.
 */
export async function initTabLock(): Promise<TabLock> {
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

export function subscribeTabLock(listener: (lock: TabLock) => void): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function requestTakeover(): void {
  if (!hasWebLocks()) {
    mode = "writer";
    emit();
    return;
  }
  void tryAcquire({ steal: true });
}

/** Test helper: drop lock state between vitest cases. Listeners stay. */
export function resetTabLockForTests(): void {
  currentAbort?.abort();
  currentAbort = null;
  startPromise = null;
  mode = "readonly";
  emit();
}
