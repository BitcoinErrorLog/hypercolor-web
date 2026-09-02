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
  consumeTrap: boolean;
};

let snapshot: BackupGateSnapshot = { recoveryCode: null, confirmedSaved: false };
const listeners = new Set<() => void>();
let pendingIntent: PendingIntent | null = null;
let trapHref: string | null = null;
let trapArmed = false;
let consumingTrap = false;
let gateRestoreFocus: HTMLElement | null = null;
let trapPushed = 0;
const HISTORY_TRAP_DEPTH = 3;

function readHistoryState(): Record<string, unknown> {
  return history.state && typeof history.state === "object"
    ? { ...(history.state as Record<string, unknown>) }
    : {};
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

export function isConsumingHistoryTrap(): boolean {
  return consumingTrap;
}

export function acknowledgeConsumedHistoryTrap(): void {
  consumingTrap = false;
}

export function armHistoryTrap(): void {
  if (typeof window === "undefined") return;
  if (!isBackupLeaveBlocked()) return;
  trapHref = window.location.href;
  trapArmed = true;
  while (trapPushed < HISTORY_TRAP_DEPTH) {
    history.pushState({ ...readHistoryState(), backupGate: true }, "", window.location.href);
    trapPushed += 1;
  }
}

/**
 * Pop the duplicate same-URL trap entry without treating it as a leave.
 * Must run after the snapshot is already unblocked so a stray popstate cannot
 * re-open the dialog.
 */
export function consumeHistoryTrap(): void {
  if (typeof window === "undefined") return;
  trapArmed = false;
  if (new URL(window.location.href, "https://hypercolor.app").pathname !== "/settings") {
    trapPushed = 0;
    return;
  }
  const n = trapPushed;
  trapPushed = 0;
  if (n <= 0) return;
  const state = history.state as { backupGate?: boolean } | null;
  if (!state?.backupGate) return;
  consumingTrap = true;
  history.go(-n);
  window.setTimeout(() => {
    consumingTrap = false;
  }, 0);
}

/**
 * Leave the gated Settings entry. After a popstate re-arm the trap sits on
 * top of the real Settings entry, so one `back()` would only pop the trap.
 */
export function runGatedHistoryLeave(): void {
  if (typeof window === "undefined") return;
  const state = history.state as { backupGate?: boolean } | null;
  const n = state?.backupGate ? trapPushed + 1 : 1;
  trapArmed = false;
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
 * `consumeTrap` (default false) pops the trap entry on confirm. History-leave
 * and router.push intents must not pop here — `history.back()` races the
 * App Router. The sanctioned Done path consumes via `clearBackupGate`.
 */
export function requestGuardedNavigation(
  run: () => void,
  options?: { consumeTrap?: boolean },
): boolean {
  if (!isBackupLeaveBlocked()) {
    run();
    return true;
  }
  pendingIntent = { run, consumeTrap: options?.consumeTrap === true };
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
  trapArmed = false;
  trapPushed = 0;
  requestGuardedNavigation(() => {
    // Already off the gated route.
  });
}

/** Pathname changed. Never clear an unsaved code just because the trap lost. */
export function onBackupGateRouteChange(pathname: string): void {
  if (pathname === "/settings") {
    if (isBackupLeaveBlocked()) armHistoryTrap();
    return;
  }
  if (isBackupLeaveBlocked()) {
    parkEscapedBackupLeave();
    return;
  }
  if (snapshot.recoveryCode) {
    clearBackupGate();
  }
}

/** popstate. Refill the trap when still on Settings; otherwise park in place. */
export function onBackupGatePopState(): void {
  if (isConsumingHistoryTrap()) {
    acknowledgeConsumedHistoryTrap();
    return;
  }
  if (!isBackupLeaveBlocked()) return;
  if (isHashOnlyHistoryChange()) {
    armHistoryTrap();
    return;
  }
  if (currentPathname() === "/settings") {
    trapPushed = (history.state as { backupGate?: boolean } | null)?.backupGate ? 1 : 0;
    armHistoryTrap();
    requestGuardedNavigation(
      () => {
        runGatedHistoryLeave();
      },
      { consumeTrap: false },
    );
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
  if (intent?.consumeTrap !== false) {
    consumeHistoryTrap();
  } else {
    trapArmed = false;
  }
  intent?.run();
  if (!trapArmed) trapPushed = 0;
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
