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
});
