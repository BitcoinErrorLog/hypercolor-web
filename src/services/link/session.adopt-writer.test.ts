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

vi.mock("@/services/KeyStore", () => ({
  KeyStore: {
    setPubky: () => setPubky(),
    getPubky: vi.fn(async () => null),
    getReceiverNoiseSecret: vi.fn(async () => null),
    clear: () => clear(),
    clearPubkyIfMatches: (expected: string, nonce: string) => clearPubkyIfMatches(expected, nonce),
  },
}));

vi.mock("@/services/StorageService", () => ({
  StorageService: {
    retryPendingCleanup: vi.fn(async () => undefined),
    getLinkReceiver: vi.fn(async () => null),
    clearAccountData: vi.fn(async () => undefined),
  },
}));

vi.mock("@/services/paykitConnectLive", () => ({
  resetPaykitConnectLive: vi.fn(),
}));

import {
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

  it("holds the critical section so a yield request is deferred until exit", async () => {
    vi.stubGlobal("navigator", {});
    enterWriterCriticalSection();
    expect(getTabLock().mode).toBe("readonly");
    exitWriterCriticalSection();
    expect(isYieldingTab()).toBe(false);
  });
});
