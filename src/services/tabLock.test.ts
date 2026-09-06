/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

type LockInfo = { name: string; mode: "exclusive" | "shared" } | null;

class FakeLockManager {
  private current: { release: () => void; abort: () => void } | null = null;

  request(
    name: string,
    optionsOrCb:
      | LockOptions
      | ((lock: LockInfo) => Promise<unknown> | unknown),
    maybeCb?: (lock: LockInfo) => Promise<unknown> | unknown,
  ): Promise<unknown> {
    const options =
      typeof optionsOrCb === "function" ? {} : (optionsOrCb ?? {});
    const callback =
      typeof optionsOrCb === "function" ? optionsOrCb : maybeCb;
    if (!callback) return Promise.resolve();
    if (options.ifAvailable && options.signal) {
      return Promise.reject(
        new DOMException(
          "ifAvailable and signal cannot be used together.",
          "NotSupportedError",
        ),
      );
    }

    return new Promise((resolve, reject) => {
      const grant = () => {
        let finished = false;
        const finish = (fn: () => void) => {
          if (finished) return;
          finished = true;
          if (this.current?.release === release) this.current = null;
          fn();
        };
        const release = () => finish(() => resolve(undefined));
        const abort = () =>
          finish(() =>
            reject(new DOMException("The request was aborted.", "AbortError")),
          );
        this.current = { release, abort };
        Promise.resolve(callback({ name, mode: "exclusive" })).then(
          (value) => finish(() => resolve(value)),
          (err) => finish(() => reject(err)),
        );
      };

      if (this.current) {
        if (options.steal) {
          this.current.abort();
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

async function loadTabLock() {
  return import("./tabLock");
}

describe("tabLock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.useRealTimers();
  });

  it("is the writer when Web Locks is missing (single-tab fallback)", async () => {
    vi.stubGlobal("navigator", {});
    const tabLock = await loadTabLock();
    const lock = await tabLock.initTabLock();
    expect(lock.mode).toBe("writer");
    expect(tabLock.getTabLock().mode).toBe("writer");
  });

  it("waits for an in-flight acquire so concurrent callers do not see stale readonly", async () => {
    const locks = new FakeLockManager();
    vi.stubGlobal("navigator", { locks });
    const tabLock = await loadTabLock();
    const [first, second] = await Promise.all([
      tabLock.initTabLock(),
      tabLock.initTabLock(),
    ]);
    expect(first.mode).toBe("writer");
    expect(second.mode).toBe("writer");
    expect(tabLock.getTabLock().mode).toBe("writer");
  });

  it("lets the first tab take the writer lock and later tabs stay readonly", async () => {
    const locks = new FakeLockManager();
    vi.stubGlobal("navigator", { locks });

    const tabA = await loadTabLock();
    expect((await tabA.initTabLock()).mode).toBe("writer");

    vi.resetModules();
    const tabB = await loadTabLock();
    expect((await tabB.initTabLock()).mode).toBe("readonly");
  });

  it("requestTakeover steals the lock and the loser becomes readonly", async () => {
    const locks = new FakeLockManager();
    vi.stubGlobal("navigator", { locks });

    const tabA = await loadTabLock();
    await tabA.initTabLock();
    expect(tabA.getTabLock().mode).toBe("writer");

    vi.resetModules();
    const tabB = await loadTabLock();
    await tabB.initTabLock();
    expect(tabB.getTabLock().mode).toBe("readonly");

    tabB.requestTakeover();
    await vi.waitFor(() => {
      expect(tabB.getTabLock().mode).toBe("writer");
    });
    await vi.waitFor(() => {
      expect(tabA.getTabLock().mode).toBe("readonly");
    });
  });

  it("flushes pending persist before the previous writer becomes readonly", async () => {
    const locks = new FakeLockManager();
    vi.stubGlobal("navigator", { locks });
    const order: string[] = [];
    const tabA = await loadTabLock();
    tabA.setBeforeWriterYield(async () => {
      order.push("flush");
    });
    tabA.subscribeTabLock((lock) => {
      if (lock.mode === "readonly" && order.includes("flush")) order.push("readonly");
    });
    await tabA.initTabLock();
    vi.resetModules();
    const tabB = await loadTabLock();
    await tabB.initTabLock();
    await tabB.requestTakeoverAndWait();
    await vi.waitFor(() => {
      expect(order[0]).toBe("flush");
      expect(order.indexOf("flush")).toBeLessThan(order.indexOf("readonly"));
    });
  });

  it("debounces focus auto-acquire by at least 1s", async () => {
    vi.useFakeTimers();
    const locks = new FakeLockManager();
    vi.stubGlobal("navigator", { locks });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    const tabA = await loadTabLock();
    await tabA.initTabLock();
    vi.resetModules();
    const tabB = await loadTabLock();
    await tabB.initTabLock();
    expect(tabB.getTabLock().mode).toBe("readonly");
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(999);
    expect(tabB.getTabLock().mode).toBe("readonly");
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(tabB.getTabLock().mode).toBe("writer"));
    vi.useRealTimers();
  });

  it("does not steal from a hidden tab on a spurious focus event", async () => {
    vi.useFakeTimers();
    const locks = new FakeLockManager();
    vi.stubGlobal("navigator", { locks });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    const tabA = await loadTabLock();
    await tabA.initTabLock();
    vi.resetModules();
    const tabB = await loadTabLock();
    await tabB.initTabLock();
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(tabB.getTabLock().mode).toBe("readonly");
    expect(tabA.getTabLock().mode).toBe("writer");
    vi.useRealTimers();
  });

  it("acquires the writer when a hidden tab becomes visible", async () => {
    vi.useFakeTimers();
    const locks = new FakeLockManager();
    vi.stubGlobal("navigator", { locks });
    let visible = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visible,
    });
    const tabA = await loadTabLock();
    await tabA.initTabLock();
    vi.resetModules();
    const tabB = await loadTabLock();
    await tabB.initTabLock();
    visible = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(tabB.getTabLock().mode).toBe("writer"));
    vi.useRealTimers();
  });
});
