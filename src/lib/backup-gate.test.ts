import { afterEach, describe, expect, it } from "vitest";
import {
  BACKUP_LEAVE_BODY,
  BACKUP_LEAVE_CONFIRM,
  BACKUP_LEAVE_STAY,
  BACKUP_LEAVE_TITLE,
  armHistoryTrap,
  canDismissRecoveryCode,
  chunkRecoveryCode,
  clearBackupGate,
  getBackupGate,
  confirmPendingBackupLeave,
  consumeHistoryTrap,
  hasPendingBackupLeave,
  isBackupLeaveBlocked,
  onBackupGatePopState,
  onBackupGateRouteChange,
  recoveryCodeDisplayState,
  requestGuardedNavigation,
  runGatedHistoryLeave,
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

type HistoryEntry = { state: unknown; url: string };

function installFakeHistory(initialUrl = "https://hypercolor.app/settings") {
  const entries: HistoryEntry[] = [{ state: null, url: initialUrl }];
  let index = 0;
  const location = {
    href: initialUrl,
    get pathname() {
      return new URL(this.href).pathname;
    },
  };
  const historyStub = {
    get state() {
      return entries[index]?.state ?? null;
    },
    get length() {
      return entries.length;
    },
    pushState(state: unknown, _title: string, url?: string) {
      const nextUrl = String(url || entries[index].url);
      entries.splice(index + 1);
      entries.push({ state, url: nextUrl });
      index = entries.length - 1;
      location.href = nextUrl;
    },
    back() {
      if (index === 0) return;
      index -= 1;
      location.href = entries[index].url;
    },
    go(delta: number) {
      const next = Math.max(0, Math.min(entries.length - 1, index + delta));
      if (next === index) return;
      index = next;
      location.href = entries[index].url;
    },
  };
  const windowStub = {
    location,
    history: historyStub,
    setTimeout(fn: () => void) {
      fn();
      return 0;
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowStub,
  });
  Object.defineProperty(globalThis, "history", {
    configurable: true,
    value: historyStub,
  });
  return historyStub;
}

function uninstallFakeHistory() {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { history?: unknown }).history;
}

describe("backup-gate history trap", () => {
  afterEach(() => {
    clearBackupGate();
    uninstallFakeHistory();
  });

  it("consumes the trap entry on clear so Back is not a silent no-op", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    expect((history.state as { backupGate?: boolean })?.backupGate).toBe(true);
    expect(hist.length).toBe(5);
    clearBackupGate();
    expect((history.state as { backupGate?: boolean })?.backupGate).toBeFalsy();
    expect(getBackupGate().recoveryCode).toBeNull();
    expect(window.location.href).toBe("https://hypercolor.app/settings");
  });

  it("re-arming while already on the trap entry is a no-op", () => {
    installFakeHistory();
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    const lengthAfterArm = history.length;
    armHistoryTrap();
    expect(history.length).toBe(lengthAfterArm);
  });

  it("history leave from a re-armed trap skips the trap entry", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    expect((history.state as { backupGate?: boolean })?.backupGate).toBe(true);
    runGatedHistoryLeave();
    expect((history.state as { backupGate?: boolean })?.backupGate).toBeFalsy();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
  });

  it("confirming a router leave runs the intent without a history.back race", () => {
    installFakeHistory();
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    let ran = false;
    requestGuardedNavigation(() => {
      ran = true;
    });
    confirmPendingBackupLeave();
    expect(ran).toBe(true);
    expect(isBackupLeaveBlocked()).toBe(false);
  });

  it("consumeHistoryTrap is a no-op when the trap was never armed", () => {
    installFakeHistory();
    consumeHistoryTrap();
    expect((history.state as { backupGate?: boolean })?.backupGate).toBeFalsy();
  });

  it("keeps the recovery code and parks the dialog after history.go(-2)", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    hist.go(-2);
    onBackupGatePopState();
    expect(window.location.href).toBe("https://hypercolor.app/settings");
    expect(getBackupGate().recoveryCode).toBe("word word word");
    expect(hasPendingBackupLeave()).toBe(true);
    expect((history.state as { recoveryCode?: string } | null)?.recoveryCode).toBeUndefined();
    confirmPendingBackupLeave();
    expect(getBackupGate().recoveryCode).toBeNull();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
  });

  it("keeps the recovery code after two history.back() calls in one turn", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    hist.back();
    hist.back();
    onBackupGatePopState();
    expect(window.location.href).toBe("https://hypercolor.app/settings");
    expect(getBackupGate().recoveryCode).toBe("word word word");
    expect(hasPendingBackupLeave()).toBe(true);
  });

  it("parks the dialog on the landed route after a jump that exhausts the trap", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    hist.go(-4);
    onBackupGatePopState();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
    expect(getBackupGate().recoveryCode).toBe("word word word");
    expect(hasPendingBackupLeave()).toBe(true);
    confirmPendingBackupLeave();
    expect(getBackupGate().recoveryCode).toBeNull();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
  });

  it("does not clear an unsaved code when the route changes", () => {
    installFakeHistory("https://hypercolor.app/profile");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    onBackupGateRouteChange("/profile");
    expect(getBackupGate().recoveryCode).toBe("word word word");
    expect(hasPendingBackupLeave()).toBe(true);
  });

  it("clears a confirmed leftover code once Settings is left", () => {
    installFakeHistory("https://hypercolor.app/chats");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: true });
    onBackupGateRouteChange("/chats");
    expect(getBackupGate().recoveryCode).toBeNull();
    expect(hasPendingBackupLeave()).toBe(false);
  });
});

