import { readFileSync } from "node:fs";
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
  cancelPendingBackupLeave,
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

  it("Leave anyway does not write or clear a previous last-backup timestamp", () => {
    rememberBackupCreated(1_700_000_000_000);
    setBackupGate({ recoveryCode: "abcd1234wxyz", confirmedSaved: false });
    confirmPendingBackupLeave();
    expect(readLastBackupAt()).toBe(1_700_000_000_000);
    expect(getBackupGate().recoveryCode).toBeNull();
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
type TrapState = { backupGate?: boolean; backupGateDepth?: unknown };

function trapEntries(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.filter((entry) => Boolean((entry.state as TrapState | null)?.backupGate));
}

function installFakeHistory(initialUrl = "https://hypercolor.app/settings") {
  const entries: HistoryEntry[] = [{ state: null, url: initialUrl }];
  let index = 0;
  const popListeners = new Set<() => void>();
  const location = {
    href: initialUrl,
    get pathname() {
      return new URL(this.href).pathname;
    },
  };
  const emitPop = () => {
    for (const listener of [...popListeners]) listener();
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
      emitPop();
    },
    go(delta: number) {
      const next = Math.max(0, Math.min(entries.length - 1, index + delta));
      if (next === index) return;
      index = next;
      location.href = entries[index].url;
      emitPop();
    },
    replaceState(state: unknown, _title: string, url?: string) {
      const current = entries[index];
      if (!current) return;
      const nextUrl = url !== undefined && url !== "" ? String(url) : current.url;
      entries[index] = { state, url: nextUrl };
      location.href = nextUrl;
    },
  };
  const windowStub = {
    location,
    history: historyStub,
    addEventListener(type: string, listener: () => void) {
      if (type === "popstate") popListeners.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      if (type === "popstate") popListeners.delete(listener);
    },
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
  return { historyStub, entries, get index() { return index; } };
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
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    expect((history.state as TrapState)?.backupGate).toBe(true);
    expect((history.state as TrapState)?.backupGateDepth).toBe(3);
    expect(hist.historyStub.length).toBe(5);
    clearBackupGate();
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
    expect(getBackupGate().recoveryCode).toBeNull();
    expect(window.location.href).toBe("https://hypercolor.app/settings");
    expect(trapEntries(hist.entries)).toHaveLength(0);
  });

  it("re-arming while already on the trap entry is a no-op", () => {
    installFakeHistory();
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    const lengthAfterArm = history.length;
    armHistoryTrap();
    expect(history.length).toBe(lengthAfterArm);
    expect((history.state as TrapState)?.backupGateDepth).toBe(3);
  });

  it("history leave from a re-armed trap skips the trap entry", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    expect((history.state as TrapState)?.backupGate).toBe(true);
    runGatedHistoryLeave();
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
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

  it("Leave anyway consumes trap entries so a single Back is the previous real route", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    expect(hist.historyStub.length).toBe(5);
    requestGuardedNavigation(() => {
      hist.historyStub.pushState({ page: "chats" }, "", "https://hypercolor.app/chats");
    });
    confirmPendingBackupLeave();
    expect(window.location.href).toBe("https://hypercolor.app/chats");
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
    hist.historyStub.back();
    expect(window.location.href).toBe("https://hypercolor.app/settings");
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
    hist.historyStub.back();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
    expect(trapEntries(hist.entries)).toHaveLength(0);
  });

  it("clearing an unarmed gate does not move history", () => {
    const hist = installFakeHistory();
    const length = hist.historyStub.length;
    clearBackupGate();
    expect(hist.historyStub.length).toBe(length);
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
  });

  it("restores trap depth from the landed entry after one Back", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    const armedLength = hist.historyStub.length;
    hist.historyStub.back();
    expect((history.state as TrapState)?.backupGateDepth).toBe(2);
    onBackupGatePopState();
    expect((history.state as TrapState)?.backupGateDepth).toBe(3);
    expect(hist.historyStub.length).toBe(armedLength);
    expect(trapEntries(hist.entries)).toHaveLength(3);
    expect(JSON.stringify(hist.entries)).not.toContain("word word word");
    confirmPendingBackupLeave();
    expect(getBackupGate().recoveryCode).toBeNull();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
    expect(trapEntries(hist.entries)).toHaveLength(0);
  });

  it("Leave anyway after one Back leaves Settings for the previous real route", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    hist.historyStub.back();
    onBackupGatePopState();
    expect(hasPendingBackupLeave()).toBe(true);
    confirmPendingBackupLeave();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
    expect(trapEntries(hist.entries)).toHaveLength(0);
  });

  it("Stay after repeated Backs then Done leaves a single real Back", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    const armedLength = hist.historyStub.length;
    for (let i = 0; i < 3; i += 1) {
      hist.historyStub.back();
      onBackupGatePopState();
      cancelPendingBackupLeave();
      armHistoryTrap();
      expect((history.state as TrapState)?.backupGateDepth).toBe(3);
      expect(trapEntries(hist.entries)).toHaveLength(3);
    }
    expect(hist.historyStub.length).toBe(armedLength);
    clearBackupGate();
    expect(window.location.href).toBe("https://hypercolor.app/settings");
    expect(trapEntries(hist.entries)).toHaveLength(0);
    hist.historyStub.back();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
  });

  it("consumes leftover trap stops whose encoded depth undercounts the stack", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    hist.historyStub.pushState(
      { backupGate: true, backupGateDepth: 3 },
      "",
      "https://hypercolor.app/settings",
    );
    expect(trapEntries(hist.entries).length).toBeGreaterThan(3);
    requestGuardedNavigation(() => undefined);
    confirmPendingBackupLeave();
    expect(window.location.href).toBe("https://hypercolor.app/settings");
    expect(trapEntries(hist.entries)).toHaveLength(0);
  });

  it("a user Back during consume does not re-arm or leave backupGate entries", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    requestGuardedNavigation(() => undefined);
    confirmPendingBackupLeave();
    hist.historyStub.back();
    onBackupGatePopState();
    expect(getBackupGate().recoveryCode).toBeNull();
    expect(hasPendingBackupLeave()).toBe(false);
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
    expect(trapEntries(hist.entries)).toHaveLength(0);
  });

  it("keeps the recovery code and parks the dialog after history.go(-2)", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    hist.historyStub.go(-2);
    onBackupGatePopState();
    expect(window.location.href).toBe("https://hypercolor.app/settings");
    expect(getBackupGate().recoveryCode).toBe("word word word");
    expect(hasPendingBackupLeave()).toBe(true);
    expect((history.state as { recoveryCode?: string } | null)?.recoveryCode).toBeUndefined();
    expect((history.state as TrapState)?.backupGateDepth).toBe(3);
    confirmPendingBackupLeave();
    expect(getBackupGate().recoveryCode).toBeNull();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
    expect(trapEntries(hist.entries)).toHaveLength(0);
  });

  it("keeps the recovery code after two history.back() calls in one turn", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    hist.historyStub.back();
    hist.historyStub.back();
    onBackupGatePopState();
    expect(window.location.href).toBe("https://hypercolor.app/settings");
    expect(getBackupGate().recoveryCode).toBe("word word word");
    expect(hasPendingBackupLeave()).toBe(true);
  });

  it("parks the dialog on the landed route after a jump that exhausts the trap", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    hist.historyStub.go(-4);
    onBackupGatePopState();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
    expect(getBackupGate().recoveryCode).toBe("word word word");
    expect(hasPendingBackupLeave()).toBe(true);
    confirmPendingBackupLeave();
    expect(getBackupGate().recoveryCode).toBeNull();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
  });

  it("iterative drain scrubs backupGate from the forward stack", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    expect(trapEntries(hist.entries)).toHaveLength(3);
    clearBackupGate();
    expect(window.location.href).toBe("https://hypercolor.app/settings");
    expect(trapEntries(hist.entries)).toHaveLength(0);
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
    const origin = hist.index;
    hist.historyStub.go(1);
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
    hist.historyStub.go(1);
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
    hist.historyStub.go(1);
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
    expect(JSON.stringify(hist.entries)).not.toContain("word word word");
    while (hist.index > origin) hist.historyStub.go(-1);
    hist.historyStub.back();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
  });

  it("scrubs reload leftovers so one Back is the previous real route", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    expect((history.state as TrapState)?.backupGateDepth).toBe(3);
    setBackupGate({ recoveryCode: null, confirmedSaved: false });
    expect(getBackupGate().recoveryCode).toBeNull();
    expect(isBackupLeaveBlocked()).toBe(false);
    expect((history.state as TrapState)?.backupGate).toBe(true);
    expect((history.state as TrapState)?.backupGateDepth).toBe(3);
    onBackupGateRouteChange("/settings");
    expect(window.location.href).toBe("https://hypercolor.app/settings");
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
    expect(trapEntries(hist.entries)).toHaveLength(0);
    hist.historyStub.back();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
  });

  it("popstate leftover with no module gate drains remaining orphan trap slots", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    setBackupGate({ recoveryCode: null, confirmedSaved: false });
    expect((history.state as TrapState)?.backupGate).toBe(true);
    onBackupGatePopState();
    expect(isBackupLeaveBlocked()).toBe(false);
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
    expect(trapEntries(hist.entries)).toHaveLength(0);
    expect(window.location.href).toBe("https://hypercolor.app/settings");
    hist.historyStub.back();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
    expect(trapEntries(hist.entries.slice(0, hist.index + 1))).toHaveLength(0);
  });

  it("off-route multi-slot orphan drain lands on the previous real route", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    expect(trapEntries(hist.entries)).toHaveLength(3);
    hist.historyStub.pushState(
      { ...(history.state as object), escaped: true },
      "",
      "https://hypercolor.app/profile",
    );
    expect(window.location.href).toBe("https://hypercolor.app/profile");
    expect((history.state as TrapState)?.backupGateDepth).toBe(3);
    setBackupGate({ recoveryCode: null, confirmedSaved: false });
    expect(isBackupLeaveBlocked()).toBe(false);
    onBackupGateRouteChange("/profile");
    expect(window.location.href).toBe("https://hypercolor.app/settings");
    expect((history.state as TrapState)?.backupGate).toBeFalsy();
    expect(trapEntries(hist.entries)).toHaveLength(0);
    hist.historyStub.back();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
    expect(JSON.stringify(hist.entries)).not.toContain("word word word");
  });

  it("no-live-gate popstate on a real entry does not skip the previous route", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    onBackupGatePopState();
    expect(window.location.href).toBe("https://hypercolor.app/settings");
    hist.historyStub.back();
    expect(window.location.href).toBe("https://hypercolor.app/profile");
  });

  it("live gate off-route park does not drain orphan traps", () => {
    const hist = installFakeHistory("https://hypercolor.app/profile");
    hist.historyStub.pushState({ page: "settings" }, "", "https://hypercolor.app/settings");
    setBackupGate({ recoveryCode: "word word word", confirmedSaved: false });
    hist.historyStub.pushState(
      { ...(history.state as object), escaped: true },
      "",
      "https://hypercolor.app/profile",
    );
    onBackupGatePopState();
    expect(getBackupGate().recoveryCode).toBe("word word word");
    expect(hasPendingBackupLeave()).toBe(true);
    expect(window.location.href).toBe("https://hypercolor.app/profile");
    expect(trapEntries(hist.entries).length).toBeGreaterThan(0);
  });

  it("does not export consume helpers", () => {
    const source = readFileSync(new URL("./backup-gate.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^export function consumeHistoryTrap/m);
    expect(source).not.toMatch(/^export function consumeHistoryTrapThen/m);
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

