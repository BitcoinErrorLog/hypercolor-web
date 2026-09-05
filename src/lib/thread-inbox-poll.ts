/** While a DM thread is visible, pull that link's inbound at this cadence. */
export const THREAD_INBOX_POLL_MS = 5_000;

export type ThreadInboxPollerDeps = {
  sync: () => Promise<void>;
  isVisible: () => boolean;
  intervalMs?: number;
  documentRef?: Pick<Document, "addEventListener" | "removeEventListener">;
  windowRef?: Pick<Window, "addEventListener" | "removeEventListener">;
};

export type ThreadInboxPoller = {
  start: () => void;
  stop: () => void;
  kick: () => Promise<void>;
};

/**
 * Bounded inbound sync for one established link while its thread is on screen.
 * The chats list keeps the slower retry-drain cadence; this poller never
 * overlaps a sync already in flight.
 */
export function createThreadInboxPoller(deps: ThreadInboxPollerDeps): ThreadInboxPoller {
  const intervalMs = deps.intervalMs ?? THREAD_INBOX_POLL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let stopped = true;

  async function kick(): Promise<void> {
    if (stopped || inFlight || !deps.isVisible()) return;
    inFlight = true;
    try {
      await deps.sync();
    } catch {
      // Local history still renders.
    } finally {
      inFlight = false;
    }
  }

  function clearTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function armTimer() {
    if (timer !== null || stopped) return;
    timer = setInterval(() => {
      void kick();
    }, intervalMs);
  }

  function onVisibilityOrFocus() {
    if (stopped) return;
    if (deps.isVisible()) {
      armTimer();
      void kick();
      return;
    }
    clearTimer();
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    if (deps.isVisible()) {
      armTimer();
      void kick();
    }
    deps.documentRef?.addEventListener("visibilitychange", onVisibilityOrFocus);
    deps.windowRef?.addEventListener("focus", onVisibilityOrFocus);
  }

  function stop() {
    stopped = true;
    clearTimer();
    deps.documentRef?.removeEventListener("visibilitychange", onVisibilityOrFocus);
    deps.windowRef?.removeEventListener("focus", onVisibilityOrFocus);
  }

  return { start, stop, kick };
}
