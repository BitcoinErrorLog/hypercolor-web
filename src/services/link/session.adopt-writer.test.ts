import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOutSession = vi.fn();

vi.mock("./PaykitLinkWeb", () => ({
  PaykitLinkWeb: {
    signOutSession: (...args: unknown[]) => signOutSession(...args),
  },
}));

const setPubky = vi.fn(async () => "adopt-a");
const clear = vi.fn(async () => undefined);
const clearPubkyIfMatches = vi.fn();

const sessionExportBox = vi.hoisted(() => ({ value: null as string | null }));
const getPubky = vi.hoisted(() => vi.fn(async () => null as string | null));

vi.mock("@/services/KeyStore", () => ({
  KeyStore: {
    setPubky: () => setPubky(),
    getPubky: () => getPubky(),
    getReceiverNoiseSecret: vi.fn(async () => null),
    clear: () => clear(),
    clearPubkyIfMatches: (expected: string, nonce: string) => clearPubkyIfMatches(expected, nonce),
    setSessionExport: vi.fn(async (value: string) => {
      sessionExportBox.value = value;
    }),
    getSessionExport: vi.fn(async () => sessionExportBox.value),
    deleteSessionExport: vi.fn(async () => {
      sessionExportBox.value = null;
    }),
  },
}));

vi.mock("@/services/StorageService", () => ({
  StorageService: {
    retryPendingCleanup: vi.fn(async () => undefined),
    getLinkReceiver: vi.fn(async () => null),
    clearAccountData: vi.fn(async () => undefined),
  },
}));

import {
  BindingMismatchError,
  adoptApprovedSession,
  resetSessionStateForTests,
  wipeSessionMetadata,
} from "./session";
import {
  resetTabLockForTests,
  enterWriterCriticalSection,
  exitWriterCriticalSection,
  isYieldingTab,
  getTabLock,
} from "@/services/tabLock";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

function exportWithCaps(...specs: string[]): string {
  return btoa(`meta${specs.join(",")}`);
}

function fakeHandle(pubky: string, exported: string) {
  return {
    pubky: () => pubky,
    exportSession: () => exported,
    free: vi.fn(),
  };
}

describe("adoptApprovedSession writer critical section", () => {
  beforeEach(async () => {
    resetSessionStateForTests();
    resetTabLockForTests();
    setPubky.mockClear();
    clear.mockClear();
    clearPubkyIfMatches.mockClear();
    getPubky.mockReset();
    getPubky.mockResolvedValue(null);
    signOutSession.mockReset();
    vi.stubGlobal("navigator", {});
  });

  afterEach(async () => {
    resetSessionStateForTests();
    resetTabLockForTests();
    await wipeSessionMetadata();
    vi.unstubAllGlobals();
  });

  it("rolls back only the adopted pubky when assertWriter fails after setPubky and the writer was lost", async () => {
    const handle = fakeHandle(
      OWNER,
      exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
    );
    setPubky.mockImplementation(async () => {
      const { resetTabLockForTests: reset } = await import("@/services/tabLock");
      reset();
      return "adopt-a";
    });
    await expect(adoptApprovedSession(handle as never)).rejects.toMatchObject({
      name: "TabLockWriterError",
    });
    expect(clearPubkyIfMatches).toHaveBeenCalledWith(OWNER, "adopt-a");
    expect(clear).not.toHaveBeenCalled();
  });

  it("does not call KeyStore.clear when setPubky itself fails", async () => {
    const handle = fakeHandle(
      OWNER,
      exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
    );
    setPubky.mockImplementation(async () => {
      throw new Error("homeserver timeout");
    });
    vi.stubGlobal("navigator", {});
    await expect(adoptApprovedSession(handle as never)).rejects.toThrow("homeserver timeout");
    expect(clear).not.toHaveBeenCalled();
    expect(clearPubkyIfMatches).not.toHaveBeenCalled();
  });

  it("signs out a mismatched approval and does not replace the persisted owner", async () => {
    const handle = fakeHandle(
      OWNER,
      exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
    );
    getPubky.mockResolvedValue("other-owner");
    await expect(adoptApprovedSession(handle as never)).rejects.toBeInstanceOf(
      BindingMismatchError,
    );
    expect(signOutSession).toHaveBeenCalledWith(handle);
    expect(setPubky).not.toHaveBeenCalled();
  });

  it("signs out a grant that does not cover Hypercolor", async () => {
    const handle = fakeHandle(OWNER, exportWithCaps("/pub/paykit/:rw"));
    await expect(adoptApprovedSession(handle as never)).rejects.toThrow(/did not grant/);
    expect(signOutSession).toHaveBeenCalledWith(handle);
    expect(setPubky).not.toHaveBeenCalled();
  });

  it("holds the critical section so a yield request is deferred until exit", async () => {
    vi.stubGlobal("navigator", {});
    enterWriterCriticalSection();
    expect(getTabLock().mode).toBe("readonly");
    exitWriterCriticalSection();
    expect(isYieldingTab()).toBe(false);
  });
});
