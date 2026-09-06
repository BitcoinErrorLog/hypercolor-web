/** @vitest-environment jsdom */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./PaykitLinkWeb", () => ({
  PaykitLinkWeb: {
    signOutSession: vi.fn(async () => undefined),
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

type LockInfo = { name: string; mode: "exclusive" | "shared" } | null;

class FakeLockManager {
  stealCount = 0;
  private held = new Map<string, true>();

  request(
    name: string,
    optionsOrCb: LockOptions | ((lock: LockInfo) => Promise<unknown> | unknown),
    maybeCb?: (lock: LockInfo) => Promise<unknown> | unknown,
  ): Promise<unknown> {
    const options = typeof optionsOrCb === "function" ? {} : (optionsOrCb ?? {});
    const callback = typeof optionsOrCb === "function" ? optionsOrCb : maybeCb;
    if (!callback) return Promise.resolve();
    if (options.steal) this.stealCount += 1;

    return new Promise((resolve, reject) => {
      const grant = () => {
        this.held.set(name, true);
        Promise.resolve(callback({ name, mode: "exclusive" })).then(
          (value) => {
            if (this.held.has(name)) this.held.delete(name);
            resolve(value);
          },
          (err) => {
            if (this.held.has(name)) this.held.delete(name);
            reject(err);
          },
        );
      };

      if (this.held.has(name)) {
        if (options.steal) {
          this.held.delete(name);
          grant();
          return;
        }
        if (options.ifAvailable) {
          Promise.resolve(callback(null)).then(resolve, reject);
          return;
        }
      }
      grant();
    });
  }
}

class FakeBroadcastChannel {
  static buses = new Map<string, Set<FakeBroadcastChannel>>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  private listeners = new Set<(event: MessageEvent) => void>();

  constructor(readonly name: string) {
    let bus = FakeBroadcastChannel.buses.get(name);
    if (!bus) {
      bus = new Set();
      FakeBroadcastChannel.buses.set(name, bus);
    }
    bus.add(this);
  }

  postMessage(data: unknown): void {
    const bus = FakeBroadcastChannel.buses.get(this.name);
    if (!bus) return;
    const event = { data } as MessageEvent;
    for (const ch of bus) {
      if (ch === this) continue;
      ch.onmessage?.(event);
      for (const listener of ch.listeners) listener(event);
    }
  }

  addEventListener(type: string, fn: EventListener): void {
    if (type === "message") this.listeners.add(fn as (event: MessageEvent) => void);
  }

  removeEventListener(type: string, fn: EventListener): void {
    if (type === "message") this.listeners.delete(fn as (event: MessageEvent) => void);
  }

  close(): void {
    FakeBroadcastChannel.buses.get(this.name)?.delete(this);
  }
}

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

describe("adoptApprovedSession real KeyStore↔tabLock wiring", () => {
  beforeEach(async () => {
    FakeBroadcastChannel.buses.clear();
    vi.stubGlobal("navigator", { locks: new FakeLockManager() });
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const { resetTabLockForTests } = await import("@/services/tabLock");
    const { resetSessionStateForTests, wipeSessionMetadata } = await import("./session");
    const { KeyStore } = await import("@/services/KeyStore");
    resetTabLockForTests();
    resetSessionStateForTests();
    await wipeSessionMetadata();
    await KeyStore.initKeyStore();
    await KeyStore.clear();
  });

  afterEach(async () => {
    const { resetTabLockForTests } = await import("@/services/tabLock");
    const { resetSessionStateForTests, wipeSessionMetadata } = await import("./session");
    const { KeyStore } = await import("@/services/KeyStore");
    resetSessionStateForTests();
    resetTabLockForTests();
    await wipeSessionMetadata();
    await KeyStore.clear();
    FakeBroadcastChannel.buses.clear();
    vi.unstubAllGlobals();
  });

  it("finishSingleApproval/adoptApprovedSession keeps KeyStore pubky and writer after setPubky", async () => {
    const { adoptApprovedSession } = await import("./session");
    const { KeyStore } = await import("@/services/KeyStore");
    const { getTabLock, getTabLockOwnerScope } = await import("@/services/tabLock");
    const { useAuthStore } = await import("@/stores/authStore");

    const handle = fakeHandle(
      OWNER,
      exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
    );

    const adopted = await adoptApprovedSession(handle as never);

    expect(adopted.pubky).toBe(OWNER);
    expect(await KeyStore.getPubky()).toBe(OWNER);
    expect(getTabLockOwnerScope()).toBe(OWNER);
    expect(getTabLock().mode).toBe("writer");
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().pubky).toBe(OWNER);
  });
});
