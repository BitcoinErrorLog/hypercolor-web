/**
 * Recovery codes must never persist. The confirm-saved gate only allows
 * dismissing the one-time display after the user says they copied it, or
 * after an explicit Leave anyway that states the consequence.
 */

export const BACKUP_LEAVE_TITLE = "Leave without saving your recovery code?";
export const BACKUP_LEAVE_BODY = "Your backup cannot be restored without it.";
export const BACKUP_LEAVE_STAY = "Go back";
export const BACKUP_LEAVE_CONFIRM = "Leave anyway";

export type BackupGateSnapshot = {
  recoveryCode: string | null;
  confirmedSaved: boolean;
};

let snapshot: BackupGateSnapshot = { recoveryCode: null, confirmedSaved: false };
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getBackupGate(): BackupGateSnapshot {
  return snapshot;
}

export function setBackupGate(next: BackupGateSnapshot): void {
  snapshot = {
    recoveryCode: next.recoveryCode,
    confirmedSaved: next.confirmedSaved,
  };
  notify();
}

export function clearBackupGate(): void {
  snapshot = { recoveryCode: null, confirmedSaved: false };
  notify();
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
    const next = new URL(href, "https://hypercolor.app");
    const here = new URL(currentPath, "https://hypercolor.app");
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
