import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOutSession = vi.fn();

vi.mock("./PaykitLinkWeb", () => ({
  PaykitLinkWeb: {
    signOutSession: (...args: unknown[]) => signOutSession(...args),
  },
}));

const setPubky = vi.fn(async () => undefined);
const clear = vi.fn(async () => undefined);

vi.mock("@/services/KeyStore", () => ({
  KeyStore: {
    setPubky: () => setPubky(),
    getPubky: vi.fn(async () => null),
    getReceiverNoiseSecret: vi.fn(async () => null),
    clear: () => clear(),
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
    vi.stubGlobal("navigator", {});
  });

  afterEach(async () => {
    resetSessionStateForTests();
    resetTabLockForTests();
    await wipeSessionMetadata();
    vi.unstubAllGlobals();
  });

  it("rolls back KeyStore when assertWriter fails after setPubky", async () => {
    const handle = fakeHandle(
      OWNER,
      exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
    );
    setPubky.mockImplementation(async () => {
      const { resetTabLockForTests: reset } = await import("@/services/tabLock");
      reset();
    });
    await expect(adoptApprovedSession(handle as never)).rejects.toMatchObject({
      name: "TabLockWriterError",
    });
    expect(clear).toHaveBeenCalled();
  });

  it("holds the critical section so a yield request is deferred until exit", async () => {
    vi.stubGlobal("navigator", {});
    enterWriterCriticalSection();
    expect(getTabLock().mode).toBe("readonly");
    exitWriterCriticalSection();
    expect(isYieldingTab()).toBe(false);
  });
});
