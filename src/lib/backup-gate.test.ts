import { afterEach, describe, expect, it } from "vitest";
import {
  BACKUP_LEAVE_BODY,
  BACKUP_LEAVE_CONFIRM,
  BACKUP_LEAVE_STAY,
  BACKUP_LEAVE_TITLE,
  canDismissRecoveryCode,
  chunkRecoveryCode,
  clearBackupGate,
  getBackupGate,
  confirmPendingBackupLeave,
  hasPendingBackupLeave,
  isBackupLeaveBlocked,
  recoveryCodeDisplayState,
  requestGuardedNavigation,
  setBackupGate,
  shouldBlockHref,
  rememberBackupCreated,
  readLastBackupAt,
} from "./backup-gate";

describe("backup-gate", () => {
  afterEach(() => {
    clearBackupGate();
  });

  it("blocks dismiss while a recovery code is on screen and unsaved", () => {
    expect(
      canDismissRecoveryCode({ recoveryCode: "abc", confirmedSaved: false }),
    ).toBe(false);
    expect(
      recoveryCodeDisplayState({ recoveryCode: "abc", confirmedSaved: false }),
    ).toBe("shown");
    expect(isBackupLeaveBlocked({ recoveryCode: "abc", confirmedSaved: false })).toBe(
      true,
    );
  });

  it("allows dismiss only after the confirm-saved gate", () => {
    expect(
      canDismissRecoveryCode({ recoveryCode: "abc", confirmedSaved: true }),
    ).toBe(true);
    expect(
      recoveryCodeDisplayState({ recoveryCode: "abc", confirmedSaved: true }),
    ).toBe("ready-to-dismiss");
    expect(isBackupLeaveBlocked({ recoveryCode: "abc", confirmedSaved: true })).toBe(
      false,
    );
  });

  it("is hidden when no code is in memory", () => {
    expect(canDismissRecoveryCode({ recoveryCode: null, confirmedSaved: false })).toBe(
      true,
    );
    expect(
      recoveryCodeDisplayState({ recoveryCode: null, confirmedSaved: false }),
    ).toBe("hidden");
    expect(isBackupLeaveBlocked({ recoveryCode: null, confirmedSaved: false })).toBe(
      false,
    );
  });

  it("chunks a recovery code for display without altering the compact form", () => {
    expect(chunkRecoveryCode("abcd1234wxyz")).toBe("abcd 1234 wxyz");
  });

  it("blocks in-app navigation away from settings while the code is unsaved", () => {
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    expect(getBackupGate().recoveryCode).toBe("word word word");
    expect(shouldBlockHref("/chats", "/settings")).toBe(true);
    expect(shouldBlockHref("/settings", "/settings")).toBe(false);
    expect(BACKUP_LEAVE_TITLE).toMatch(/recovery code/);
    expect(BACKUP_LEAVE_BODY).toMatch(/cannot be restored/);
    expect(BACKUP_LEAVE_STAY).toBe("Go back");
    expect(BACKUP_LEAVE_CONFIRM).toBe("Leave anyway");
  });

  it("stops blocking after Leave anyway clears the gate", () => {
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    clearBackupGate();
    expect(shouldBlockHref("/chats", "/settings")).toBe(false);
  });

  it("records a local last-backup timestamp for the sign-out sheet", () => {
    rememberBackupCreated(1_700_000_000_000);
    expect(readLastBackupAt()).toBe(1_700_000_000_000);
  });

  it("ignores hash-only hrefs and holds guarded navigation until Leave anyway", () => {
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    expect(shouldBlockHref("#backup", "/settings")).toBe(false);
    let ran = false;
    expect(
      requestGuardedNavigation(() => {
        ran = true;
      }),
    ).toBe(false);
    expect(ran).toBe(false);
    expect(hasPendingBackupLeave()).toBe(true);
    confirmPendingBackupLeave();
    expect(ran).toBe(true);
    expect(hasPendingBackupLeave()).toBe(false);
    expect(isBackupLeaveBlocked()).toBe(false);
  });
});
