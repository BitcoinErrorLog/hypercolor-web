/**
 * Recovery codes must never persist to history, URL, or storage.
 * The confirm-saved gate only allows dismissing the one-time display after
 * the user says they copied it, or after an explicit Leave anyway that
 * states the consequence.
 *
 * The code is a random 32-byte key generated at export time and cannot be
 * re-derived from the signed-in session. It stays in module memory until
 * Done, Leave anyway, sign-out, or page unload — including when a history
 * jump exhausts the history trap. The leave dialog re-parks on the landed
 * route so the user still chooses.
 */

export const BACKUP_LEAVE_TITLE = "Leave without saving your recovery code?";
export const BACKUP_LEAVE_BODY = "Your backup cannot be restored without it.";
export const BACKUP_LEAVE_STAY = "Go back";
export const BACKUP_LEAVE_CONFIRM = "Leave anyway";

export type BackupGateSnapshot = {
  recoveryCode: string | null;
  confirmedSaved: boolean;
};

type PendingIntent = {
  run: () => void;
};

let snapshot: BackupGateSnapshot = { recoveryCode: null, confirmedSaved: false };
const listeners = new Set<() => void>();
let pendingIntent: PendingIntent | null = null;
let trapHref: string | null = null;
let consumingTrap = false;
let gateRestoreFocus: HTMLElement | null = null;
let trapPushed = 0;
const HISTORY_TRAP_DEPTH = 3;

type BackupGateHistoryState = {
  backupGate?: boolean;
  backupGateDepth?: unknown;
};

function readHistoryState(): Record<string, unknown> {
  return history.state && typeof history.state === "object"
    ? { ...(history.state as Record<string, unknown>) }
    : {};
}

function currentEntryHasBackupGate(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;
  const record = state as BackupGateHistoryState;
  return record.backupGate === true || record.backupGateDepth != null;
}

function historyStateWithoutBackupGate(
  state: Record<string, unknown>,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...state };
  delete next.backupGate;
  delete next.backupGateDepth;
  return Object.keys(next).length === 0 ? null : next;
}

/** Strip trap flags from the current entry. Never write the recovery code. */
function scrubBackupGateFromCurrentEntry(): boolean {
  if (typeof history === "undefined" || typeof history.replaceState !== "function") {
    return false;
  }
  const state = readHistoryState();
  if (!currentEntryHasBackupGate(state)) return false;
  history.replaceState(
    historyStateWithoutBackupGate(state),
    "",
    typeof window !== "undefined" ? window.location.href : "",
  );
  return true;
}

/** Depth encoded on each trap entry. Never store the recovery code here. */
function trapDepthFromState(state: unknown): number {
  if (!state || typeof state !== "object") return 0;
  const record = state as BackupGateHistoryState;
  if (record.backupGate !== true) return 0;
  const depth = record.backupGateDepth;
  if (depth === 1 || depth === 2 || depth === 3) return depth;
  return 1;
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function getBackupGate(): BackupGateSnapshot {
  return snapshot;
}

export function hasPendingBackupLeave(): boolean {
  return pendingIntent !== null;
}

export function armHistoryTrap(): void {
  if (typeof window === "undefined") return;
  if (!isBackupLeaveBlocked()) return;
  trapHref = window.location.href;
  trapPushed = trapDepthFromState(history.state);
  while (trapPushed < HISTORY_TRAP_DEPTH) {
    const nextDepth = trapPushed + 1;
    history.pushState(
      { ...readHistoryState(), backupGate: true, backupGateDepth: nextDepth },
      "",
      window.location.href,
    );
    trapPushed = nextDepth;
  }
}

/**
 * Pop remaining same-URL trap entries without treating them as a leave.
 * Before leaving each trap entry, `replaceState` removes `backupGate` /
 * `backupGateDepth` so those flags cannot remain on the forward stack.
 * Then traverse one entry and wait for its `popstate` before the next step.
 * Popstates are suppressed for the whole drain; a user Back in that window is
 * folded into the leftover depth instead of re-arming. `done` runs after the
 * pops settle.
 *
 * Orphan mode (`options.orphan`) keeps going on any pathname until a non-trap
 * entry. Settings mode stops off `/settings` so a live leave does not yank
 * the user back through history.
 */
function stillHasOrphanTrap(): boolean {
  if (typeof history === "undefined") return false;
  return currentEntryHasBackupGate(history.state);
}

function stillHasSettingsTrap(): boolean {
  return currentPathname() === "/settings" && trapDepthFromState(history.state) > 0;
}

function consumeHistoryTrapThen(done: () => void, options?: { orphan?: boolean }): void {
  const orphan = options?.orphan === true;
  if (typeof window === "undefined") {
    trapPushed = 0;
    done();
    return;
  }
  trapPushed = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    consumingTrap = false;
    if (typeof window.removeEventListener === "function") {
      window.removeEventListener("popstate", onPop);
    }
    done();
  };
  const drainStep = () => {
    if (finished) return;
    if (orphan) {
      if (!stillHasOrphanTrap()) {
        finish();
        return;
      }
      scrubBackupGateFromCurrentEntry();
      history.go(-1);
      return;
    }
    if (currentPathname() !== "/settings") {
      scrubBackupGateFromCurrentEntry();
      finish();
      return;
    }
    if (trapDepthFromState(history.state) <= 0) {
      scrubBackupGateFromCurrentEntry();
      finish();
      return;
    }
    scrubBackupGateFromCurrentEntry();
    history.go(-1);
  };
  const onPop = () => {
    if (finished) return;
    if (typeof window.setTimeout === "function") {
      window.setTimeout(drainStep, 0);
      return;
    }
    drainStep();
  };
  if (typeof window.addEventListener !== "function") {
    consumingTrap = true;
    drainStep();
    while (!finished && (orphan ? stillHasOrphanTrap() : stillHasSettingsTrap())) {
      drainStep();
    }
    finish();
    return;
  }
  consumingTrap = true;
  window.addEventListener("popstate", onPop);
  drainStep();
  if (typeof window.setTimeout === "function") {
    window.setTimeout(() => {
      if (finished) return;
      drainStep();
      window.setTimeout(finish, 250);
    }, 250);
  }
}

/**
 * Reload leftover: trap flags can survive in `history.state` after module
 * memory is gone. The user is not gated. Drain consecutive orphan trap
 * slots — including off-route parked entries — until a non-trap entry so
 * the next Back is the real previous route. Never runs while the gate is live.
 */
function scrubOrphanBackupGateHistory(): void {
  if (typeof window === "undefined") return;
  if (isBackupLeaveBlocked()) return;
  if (consumingTrap) return;
  if (!stillHasOrphanTrap()) {
    scrubBackupGateFromCurrentEntry();
    return;
  }
  consumeHistoryTrapThen(() => undefined, { orphan: true });
}

function consumeHistoryTrap(): void {
  consumeHistoryTrapThen(() => undefined);
}

/**
 * Leave the gated Settings entry. After a popstate re-arm the trap sits on
 * top of the real Settings entry, so one `back()` would only pop the trap.
 */
export function runGatedHistoryLeave(): void {
  if (typeof window === "undefined") return;
  const depth = trapDepthFromState(history.state);
  const n = depth > 0 ? depth + 1 : 1;
  trapPushed = 0;
  history.go(-n);
}

/** True when popstate only changed the hash on the gated page. */
export function isHashOnlyHistoryChange(): boolean {
  if (typeof window === "undefined" || !trapHref) return false;
  try {
    const here = new URL(window.location.href);
    const trap = new URL(trapHref);
    return (
      here.pathname === trap.pathname &&
      here.search === trap.search &&
      here.hash !== trap.hash
    );
  } catch {
    return false;
  }
}

export function setBackupGate(next: BackupGateSnapshot): void {
  const wasBlocked = isBackupLeaveBlocked();
  snapshot = {
    recoveryCode: next.recoveryCode,
    confirmedSaved: next.confirmedSaved,
  };
  if (isBackupLeaveBlocked() && !wasBlocked) {
    armHistoryTrap();
  }
  if (!isBackupLeaveBlocked()) {
    pendingIntent = null;
  }
  notify();
}

export function clearBackupGate(): void {
  snapshot = { recoveryCode: null, confirmedSaved: false };
  pendingIntent = null;
  trapHref = null;
  gateRestoreFocus = null;
  notify();
  consumeHistoryTrap();
}

/**
 * Run `run` now, or hold it until the user confirms Leave anyway.
 * Returns true when the action proceeded immediately.
 *
 * Confirm always consumes remaining trap entries (with suppressed popstates)
 * before `run`, so Leave anyway cannot leave stale `/settings` trap stops.
 */
export function requestGuardedNavigation(run: () => void): boolean {
  if (!isBackupLeaveBlocked()) {
    run();
    return true;
  }
  pendingIntent = { run };
  notify();
  return false;
}

export function cancelPendingBackupLeave(): void {
  pendingIntent = null;
  notify();
}

export function parkGateRestoreFocus(el: HTMLElement | null): void {
  gateRestoreFocus = el;
}

export function getGateRestoreFocus(): HTMLElement | null {
  return gateRestoreFocus;
}

function currentPathname(): string {
  if (typeof window === "undefined") return "";
  try {
    return new URL(window.location.href).pathname;
  } catch {
    return "";
  }
}

/**
 * History jumped off Settings while the one-time code is still unsaved.
 * Keep the code in module memory and park the leave dialog on this route.
 * Leave anyway is a no-op navigation — the user is already off Settings.
 */
function parkEscapedBackupLeave(): void {
  trapPushed = 0;
  requestGuardedNavigation(() => {
    // Already off the gated route.
  });
}

/** Pathname changed. Never clear an unsaved code just because the trap lost. */
export function onBackupGateRouteChange(pathname: string): void {
  if (pathname === "/settings") {
    if (isBackupLeaveBlocked()) armHistoryTrap();
    else scrubOrphanBackupGateHistory();
    return;
  }
  if (isBackupLeaveBlocked()) {
    parkEscapedBackupLeave();
    return;
  }
  if (snapshot.recoveryCode) {
    clearBackupGate();
    return;
  }
  scrubOrphanBackupGateHistory();
}

/** popstate. Refill the trap when still on Settings; otherwise park in place. */
export function onBackupGatePopState(): void {
  if (consumingTrap) return;
  if (!isBackupLeaveBlocked()) {
    if (stillHasOrphanTrap()) {
      consumeHistoryTrapThen(() => undefined, { orphan: true });
      return;
    }
    scrubBackupGateFromCurrentEntry();
    return;
  }
  if (isHashOnlyHistoryChange()) {
    armHistoryTrap();
    return;
  }
  if (currentPathname() === "/settings") {
    armHistoryTrap();
    requestGuardedNavigation(() => {
      runGatedHistoryLeave();
    });
    return;
  }
  parkEscapedBackupLeave();
}

export function confirmPendingBackupLeave(): void {
  const intent = pendingIntent;
  pendingIntent = null;
  snapshot = { recoveryCode: null, confirmedSaved: false };
  trapHref = null;
  gateRestoreFocus = null;
  notify();
  consumeHistoryTrapThen(() => {
    intent?.run();
  });
}

export function subscribeBackupGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function canDismissRecoveryCode(input: {
  recoveryCode: string | null;
  confirmedSaved: boolean;
}): boolean {
  if (!input.recoveryCode) return true;
  return input.confirmedSaved;
}

export function isBackupLeaveBlocked(
  input: BackupGateSnapshot = snapshot,
): boolean {
  return Boolean(input.recoveryCode) && !input.confirmedSaved;
}

export function recoveryCodeDisplayState(input: {
  recoveryCode: string | null;
  confirmedSaved: boolean;
}): "hidden" | "shown" | "ready-to-dismiss" {
  if (!input.recoveryCode) return "hidden";
  return input.confirmedSaved ? "ready-to-dismiss" : "shown";
}

/** Chunk a recovery code for display. Never persist the result. */
export function chunkRecoveryCode(code: string): string {
  const compact = code.replace(/\s+/g, "");
  return compact.match(/.{1,4}/g)?.join(" ") ?? compact;
}

export function shouldBlockHref(href: string, currentPath: string): boolean {
  if (!isBackupLeaveBlocked()) return false;
  try {
    const origin = "https://hypercolor.app";
    const here = new URL(currentPath || "/", origin);
    const next = new URL(href, here);
    return next.pathname !== here.pathname;
  } catch {
    return true;
  }
}

const LAST_BACKUP_AT_KEY = "hypercolor.lastBackupAt";
let memoryLastBackupAt: number | null = null;

/** Local UI timestamp for the sign-out sheet. Not a protocol secret. */
export function rememberBackupCreated(at: number = Date.now()): void {
  memoryLastBackupAt = at;
  try {
    localStorage.setItem(LAST_BACKUP_AT_KEY, String(at));
  } catch {
    // private mode / node tests
  }
}

export function readLastBackupAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_AT_KEY);
    if (raw) {
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
  } catch {
    // private mode / node tests
  }
  return memoryLastBackupAt;
}
