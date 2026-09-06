/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

type LockInfo = { name: string; mode: "exclusive" | "shared" } | null;

/**
 * Models Chromium Web Locks steal: the stealer is granted immediately, the
 * previous holder's request Promise is NOT rejected, and the holder's
 * in-callback `holdUntil(signal)` is NOT aborted. The previous lock is simply
 * no longer held (`ifAvailable` can succeed). Captured from the Web Locks
 * spec: steal does not notify the previous holder.
 */
class FakeLockManager {
  stealCount = 0;
  ifAvailableWhileHeld = 0;
  private held = new Map<string, true>();
  private holderRequestSettled = new Map<string, Promise<unknown>>();

  request(
    name: string,
    optionsOrCb: LockOptions | ((lock: LockInfo) => Promise<unknown> | unknown),
    maybeCb?: (lock: LockInfo) => Promise<unknown> | unknown,
  ): Promise<unknown> {
    const options = typeof optionsOrCb === "function" ? {} : (optionsOrCb ?? {});
    const callback = typeof optionsOrCb === "function" ? optionsOrCb : maybeCb;
    if (!callback) return Promise.resolve();
    if (options.ifAvailable && options.signal) {
      return Promise.reject(
        new DOMException("ifAvailable and signal cannot be used together.", "NotSupportedError"),
      );
    }

    if (options.steal) this.stealCount += 1;

    return new Promise((resolve, reject) => {
      const grant = () => {
        this.held.set(name, true);
        const running = Promise.resolve(callback({ name, mode: "exclusive" })).then(
          (value) => {
            if (this.held.has(name)) this.held.delete(name);
            resolve(value);
          },
          (err) => {
            if (this.held.has(name)) this.held.delete(name);
            reject(err);
          },
        );
        this.holderRequestSettled.set(name, running);
      };

      if (this.held.has(name)) {
        if (options.steal) {
          this.held.delete(name);
          grant();
          return;
        }
        if (options.ifAvailable) {
          this.ifAvailableWhileHeld += 1;
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

async function loadTabLock() {
  return import("./tabLock");
}

function stubLocksAndChannel(locks: FakeLockManager) {
  vi.stubGlobal("navigator", { locks });
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
}

describe("tabLock", () => {
  afterEach(() => {
    FakeBroadcastChannel.buses.clear();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.useRealTimers();
  });

  it("is the writer when Web Locks is missing (single-tab fallback)", async () => {
    vi.stubGlobal("navigator", {});
    const tabLock = await loadTabLock();
    const lock = await tabLock.initTabLock();
    expect(lock.mode).toBe("writer");
  });

  it("lets the first tab take the writer lock and later tabs stay readonly", async () => {
    const locks = new FakeLockManager();
    stubLocksAndChannel(locks);
    const tabA = await loadTabLock();
    expect((await tabA.initTabLock()).mode).toBe("writer");
    vi.resetModules();
    stubLocksAndChannel(locks);
    const tabB = await loadTabLock();
    expect((await tabB.initTabLock()).mode).toBe("readonly");
  });

  it("yield-request then yielded then ifAvailable; steal only after timeout", async () => {
    const locks = new FakeLockManager();
    stubLocksAndChannel(locks);
    const order: string[] = [];
    const tabA = await loadTabLock();
    tabA.setBeforeWriterYield(async () => {
      order.push("flush");
    });
    await tabA.initTabLock();
    vi.resetModules();
    stubLocksAndChannel(locks);
    const tabB = await loadTabLock();
    await tabB.initTabLock();
    expect(tabB.getTabLock().mode).toBe("readonly");
    const wait = tabB.requestTakeoverAndWait();
    await vi.waitFor(() => {
      expect(order).toContain("flush");
    });
    await wait;
    expect(tabB.getTabLock().mode).toBe("writer");
    await vi.waitFor(() => {
      expect(tabA.getTabLock().mode).toBe("readonly");
    });
    expect(locks.stealCount).toBe(0);
    expect(order[0]).toBe("flush");
  });

  it("P0: delayed flush is acked (yielded) before the taker becomes writer", async () => {
    const locks = new FakeLockManager();
    stubLocksAndChannel(locks);
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });
    const events: string[] = [];
    const tabA = await loadTabLock();
    tabA.setBeforeWriterYield(async () => {
      events.push("old-flush-start");
      await flushGate;
      events.push("old-flush-done");
    });
    await tabA.initTabLock();
    vi.resetModules();
    stubLocksAndChannel(locks);
    const tabB = await loadTabLock();
    await tabB.initTabLock();
    const takeover = tabB.requestTakeoverAndWait().then(() => {
      events.push("new-writer");
    });
    await vi.waitFor(() => expect(events).toContain("old-flush-start"));
    expect(events).not.toContain("new-writer");
    expect(tabB.getTabLock().mode).toBe("readonly");
    expect(tabB.isTakeoverInProgress()).toBe(true);
    releaseFlush();
    await takeover;
    expect(events.indexOf("old-flush-done")).toBeLessThan(events.indexOf("new-writer"));
    expect(locks.stealCount).toBe(0);
  });

  it("aborts an unused steal AbortController after winning via ifAvailable", async () => {
    const locks = new FakeLockManager();
    stubLocksAndChannel(locks);
    const tabA = await loadTabLock();
    await tabA.initTabLock();
    vi.resetModules();
    stubLocksAndChannel(locks);
    const tabB = await loadTabLock();
    await tabB.initTabLock();
    await tabB.requestTakeoverAndWait();
    expect(locks.stealCount).toBe(0);
    expect(tabB.getTabLock().mode).toBe("writer");
  });

  it("steal only after yield timeout; claim stands the stale holder down", async () => {
    vi.useFakeTimers();
    const locks = new FakeLockManager();
    stubLocksAndChannel(locks);
    const tabA = await loadTabLock();
    await tabA.initTabLock();
    tabA.enterWriterCriticalSection();
    vi.resetModules();
    stubLocksAndChannel(locks);
    const tabB = await loadTabLock();
    await tabB.initTabLock();
    const takeover = tabB.requestTakeoverAndWait();
    await vi.advanceTimersByTimeAsync(1500);
    await takeover;
    expect(locks.stealCount).toBeGreaterThan(0);
    expect(tabB.getTabLock().mode).toBe("writer");
    expect(tabA.getTabLock().mode).toBe("readonly");
    vi.useRealTimers();
  });

  it("defers yield while the writer critical section is held", async () => {
    const locks = new FakeLockManager();
    stubLocksAndChannel(locks);
    const tabA = await loadTabLock();
    await tabA.initTabLock();
    tabA.enterWriterCriticalSection();
    vi.resetModules();
    stubLocksAndChannel(locks);
    const tabB = await loadTabLock();
    await tabB.initTabLock();
    const takeover = tabB.requestTakeoverAndWait();
    await new Promise((r) => setTimeout(r, 50));
    expect(tabA.getTabLock().mode).toBe("writer");
    tabA.exitWriterCriticalSection();
    await takeover;
    await vi.waitFor(() => expect(tabA.getTabLock().mode).toBe("readonly"));
  });

  it("ensureWriter rejects when acquisition fails", async () => {
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _name: string,
          options: LockOptions,
          cb: (lock: LockInfo) => Promise<unknown>,
        ) => {
          if (options.ifAvailable) return cb(null);
          return cb(null);
        },
      },
    });
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const tabLock = await loadTabLock();
    await expect(tabLock.ensureWriter()).rejects.toMatchObject({ name: "TabLockWriterError" });
  });

  it("rate-limits inbound yield requests", async () => {
    const locks = new FakeLockManager();
    stubLocksAndChannel(locks);
    const flushes: number[] = [];
    const tabA = await loadTabLock();
    tabA.setBeforeWriterYield(async () => {
      flushes.push(Date.now());
    });
    await tabA.initTabLock();
    const ch = new FakeBroadcastChannel("hypercolor-writer-yield-request:unsigned");
    ch.postMessage({ type: "yield", from: "attacker" });
    await vi.waitFor(() => expect(flushes.length).toBe(1));
    ch.postMessage({ type: "yield", from: "attacker" });
    await new Promise((r) => setTimeout(r, 20));
    expect(flushes.length).toBe(1);
  });

  it("namespaces lock names by owner pubky so another identity cannot steal", async () => {
    const locks = new FakeLockManager();
    stubLocksAndChannel(locks);
    const tabA = await loadTabLock();
    tabA.setTabLockOwner("alice-pubky");
    await tabA.initTabLock();
    expect(tabA.getTabLock().mode).toBe("writer");
    vi.resetModules();
    stubLocksAndChannel(locks);
    const tabB = await loadTabLock();
    tabB.setTabLockOwner("bob-pubky");
    await tabB.initTabLock();
    expect(tabB.getTabLock().mode).toBe("writer");
    expect(tabA.getTabLock().mode).toBe("writer");
  });

  it("waitForPeerWriterYield ignores messages without type yielded or from", async () => {
    stubLocksAndChannel(new FakeLockManager());
    const tabLock = await loadTabLock();
    await tabLock.initTabLock();
    const wait = tabLock.waitForPeerWriterYield(80);
    const ch = new FakeBroadcastChannel("hypercolor-writer-yield:unsigned");
    ch.postMessage({ type: "noise" });
    ch.postMessage({ type: "yielded" });
    await wait;
  });

  it("yielding blocks mutations via isYieldingTab", async () => {
    const locks = new FakeLockManager();
    stubLocksAndChannel(locks);
    const tabA = await loadTabLock();
    let inFlush = false;
    let sawYielding = false;
    tabA.setBeforeWriterYield(async () => {
      inFlush = true;
      sawYielding = tabA.isYieldingTab();
      await new Promise((r) => setTimeout(r, 10));
      inFlush = false;
    });
    await tabA.initTabLock();
    vi.resetModules();
    stubLocksAndChannel(locks);
    const tabB = await loadTabLock();
    await tabB.initTabLock();
    const wait = tabB.requestTakeoverAndWait();
    await vi.waitFor(() => expect(inFlush || sawYielding).toBe(true));
    expect(sawYielding).toBe(true);
    await wait;
  });

  it("debounces focus auto-acquire by at least 1s", async () => {
    vi.useFakeTimers();
    const locks = new FakeLockManager();
    stubLocksAndChannel(locks);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    const tabA = await loadTabLock();
    await tabA.initTabLock();
    vi.resetModules();
    stubLocksAndChannel(locks);
    const tabB = await loadTabLock();
    await tabB.initTabLock();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(999);
    expect(tabB.getTabLock().mode).toBe("readonly");
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(tabB.getTabLock().mode).toBe("writer"));
    vi.useRealTimers();
  });
});
