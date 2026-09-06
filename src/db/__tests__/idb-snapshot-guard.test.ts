import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IDB_KEY,
  IDB_META_KEY,
  IDB_STORE,
  bumpPersistGeneration,
  compareSnapshotMeta,
  currentPersistGeneration,
  currentPersistNonce,
  currentSqliteIdbName,
  isExpectedStalePersistRefusal,
  preparePersistGenerationForOpen,
  putIdbSnapshot,
  resetPersistGenerationForTests,
  sealPersistGenerationInIdb,
} from "../openWebSqlite";
import { SQLITE_PERSIST_FAILED_EVENT, SqlitePersistError, STALE_SNAPSHOT_GENERATION } from "../errors";
import {
  resetTabLockForTests,
  setTabLockModeForTests,
  setTabLockOwner,
  setYieldingForTests,
} from "@/services/tabLock";

const BUNDLE = "test-bundle";

async function readMeta(name: string): Promise<{ generation: number; nonce?: string } | null> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const get = tx.objectStore(IDB_STORE).get(IDB_META_KEY);
      get.onsuccess = () => resolve((get.result as { generation: number; nonce?: string } | undefined) ?? null);
      get.onerror = () => reject(get.error);
    });
  } finally {
    db.close();
  }
}

async function readBlob(name: string): Promise<Uint8Array | null> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const get = tx.objectStore(IDB_STORE).get(IDB_KEY);
      get.onsuccess = () => {
        const value = get.result;
        if (value instanceof Uint8Array) resolve(value);
        else if (value instanceof ArrayBuffer) resolve(new Uint8Array(value));
        else resolve(null);
      };
      get.onerror = () => reject(get.error);
    });
  } finally {
    db.close();
  }
}

describe("idb snapshot generation guard", () => {
  afterEach(async () => {
    const name = currentSqliteIdbName();
    resetTabLockForTests();
    resetPersistGenerationForTests();
    vi.unstubAllGlobals();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it("writes blob and meta in one transaction and refuses older generation puts", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await putIdbSnapshot(bytes, {
      userVersion: 1,
      bundleId: BUNDLE,
      generation: currentPersistGeneration(),
      nonce: "aaa",
    });
    const name = currentSqliteIdbName();
    expect(await readBlob(name)).toEqual(bytes);
    const meta = await readMeta(name);
    expect(meta?.generation).toBe(1);

    bumpPersistGeneration();
    await expect(
      putIdbSnapshot(new Uint8Array([9]), {
        userVersion: 1,
        bundleId: BUNDLE,
        generation: 1,
        nonce: "old",
      }),
    ).rejects.toBeInstanceOf(SqlitePersistError);
    expect(await readBlob(name)).toEqual(bytes);
  });

  it("seal adopts stored generation then bumps so gen 2, 5, and 1000 lose to the new writer", async () => {
    for (const storedGen of [2, 5, 1000]) {
      resetTabLockForTests();
      resetPersistGenerationForTests();
      const name = currentSqliteIdbName();
      await putIdbSnapshot(new Uint8Array([storedGen]), {
        userVersion: 1,
        bundleId: BUNDLE,
        generation: storedGen,
        nonce: "zzzz-old-nonce",
      });
      resetPersistGenerationForTests();
      await sealPersistGenerationInIdb();
      expect(currentPersistGeneration()).toBe(storedGen + 1);
      const sealed = await readMeta(name);
      expect(sealed?.generation).toBe(storedGen + 1);
      await putIdbSnapshot(new Uint8Array([9, storedGen]), {
        userVersion: 1,
        bundleId: BUNDLE,
        generation: currentPersistGeneration(),
        nonce: currentPersistNonce(),
      });
      expect(await readBlob(name)).toEqual(new Uint8Array([9, storedGen]));
      await expect(
        putIdbSnapshot(new Uint8Array([1]), {
          userVersion: 1,
          bundleId: BUNDLE,
          generation: storedGen,
          nonce: "zzzz-old-nonce",
        }),
      ).rejects.toBeInstanceOf(SqlitePersistError);
      expect(await readBlob(name)).toEqual(new Uint8Array([9, storedGen]));
    }
  });

  it("cold-open writer adopts then bumps so a first put against zzzz nonce lands", async () => {
    const storedGen = 7;
    const name = currentSqliteIdbName();
    await putIdbSnapshot(new Uint8Array([1]), {
      userVersion: 1,
      bundleId: BUNDLE,
      generation: storedGen,
      nonce: "zzzzzzzzzzzz",
    });
    resetPersistGenerationForTests();
    setTabLockModeForTests("writer");
    preparePersistGenerationForOpen({
      userVersion: 1,
      bundleId: BUNDLE,
      generation: storedGen,
      nonce: "zzzzzzzzzzzz",
    });
    expect(currentPersistGeneration()).toBe(storedGen + 1);
    await putIdbSnapshot(new Uint8Array([9, 9]), {
      userVersion: 1,
      bundleId: BUNDLE,
      generation: currentPersistGeneration(),
      nonce: currentPersistNonce(),
    });
    expect(await readBlob(name)).toEqual(new Uint8Array([9, 9]));
  });

  it("cold-open reader adopts without bumping and does not put", async () => {
    const storedGen = 7;
    const name = currentSqliteIdbName();
    const original = new Uint8Array([4, 4]);
    await putIdbSnapshot(original, {
      userVersion: 1,
      bundleId: BUNDLE,
      generation: storedGen,
      nonce: "zzzzzzzzzzzz",
    });
    resetPersistGenerationForTests();
    setTabLockModeForTests("readonly");
    preparePersistGenerationForOpen({
      userVersion: 1,
      bundleId: BUNDLE,
      generation: storedGen,
      nonce: "zzzzzzzzzzzz",
    });
    expect(currentPersistGeneration()).toBe(storedGen);
    expect(await readBlob(name)).toEqual(original);
    expect(await readMeta(name)).toMatchObject({ generation: storedGen, nonce: "zzzzzzzzzzzz" });
  });

  it("refused stale put as writer emits SQLITE_PERSIST_FAILED_EVENT", async () => {
    setTabLockModeForTests("writer");
    await putIdbSnapshot(new Uint8Array([3]), {
      userVersion: 1,
      bundleId: BUNDLE,
      generation: 10,
      nonce: "zzzzzzzzzzzz",
    });
    resetPersistGenerationForTests();
    const events: string[] = [];
    vi.stubGlobal("window", {
      dispatchEvent: (event: Event) => {
        if (event instanceof CustomEvent && event.type === SQLITE_PERSIST_FAILED_EVENT) {
          events.push(String(event.detail));
        }
        return true;
      },
    });
    await expect(
      putIdbSnapshot(new Uint8Array([9]), {
        userVersion: 1,
        bundleId: BUNDLE,
        generation: 1,
        nonce: "aaaa",
      }),
    ).rejects.toBeInstanceOf(SqlitePersistError);
    expect(events.some((detail) => detail.includes(STALE_SNAPSHOT_GENERATION))).toBe(true);
  });

  it("expected stale refusal while yielding does not emit SQLITE_PERSIST_FAILED_EVENT", async () => {
    setTabLockModeForTests("writer");
    setYieldingForTests(true);
    await putIdbSnapshot(new Uint8Array([3]), {
      userVersion: 1,
      bundleId: BUNDLE,
      generation: 10,
      nonce: "zzzzzzzzzzzz",
    });
    resetPersistGenerationForTests();
    const events: string[] = [];
    vi.stubGlobal("window", {
      dispatchEvent: (event: Event) => {
        if (event instanceof CustomEvent && event.type === SQLITE_PERSIST_FAILED_EVENT) {
          events.push(String(event.detail));
        }
        return true;
      },
    });
    const stale = new SqlitePersistError(STALE_SNAPSHOT_GENERATION);
    expect(isExpectedStalePersistRefusal(stale)).toBe(true);
    await expect(
      putIdbSnapshot(new Uint8Array([9]), {
        userVersion: 1,
        bundleId: BUNDLE,
        generation: 1,
        nonce: "aaaa",
      }),
    ).rejects.toBeInstanceOf(SqlitePersistError);
    expect(events).toEqual([]);
  });

  it("expected stale refusal does not latch lastPersistError so reads stay live", () => {
    setTabLockModeForTests("writer");
    setYieldingForTests(true);
    let lastPersistError: SqlitePersistError | null = null;
    const err = new SqlitePersistError(STALE_SNAPSHOT_GENERATION);
    if (!isExpectedStalePersistRefusal(err)) {
      lastPersistError = err;
    }
    expect(lastPersistError).toBeNull();
    expect(() => {
      if (lastPersistError) throw lastPersistError;
    }).not.toThrow();
  });

  it("reader-to-writer seal lands first put against zzzz nonce", async () => {
    const storedGen = 7;
    const name = currentSqliteIdbName();
    await putIdbSnapshot(new Uint8Array([1]), {
      userVersion: 1,
      bundleId: BUNDLE,
      generation: storedGen,
      nonce: "zzzzzzzzzzzz",
    });
    resetPersistGenerationForTests();
    setTabLockModeForTests("readonly");
    preparePersistGenerationForOpen({
      userVersion: 1,
      bundleId: BUNDLE,
      generation: storedGen,
      nonce: "zzzzzzzzzzzz",
    });
    expect(currentPersistGeneration()).toBe(storedGen);
    await sealPersistGenerationInIdb();
    expect(currentPersistGeneration()).toBe(storedGen + 1);
    await putIdbSnapshot(new Uint8Array([9, 9]), {
      userVersion: 1,
      bundleId: BUNDLE,
      generation: currentPersistGeneration(),
      nonce: currentPersistNonce(),
    });
    expect(await readBlob(name)).toEqual(new Uint8Array([9, 9]));
  });

  it("tie-breaks equal generation with nonce", () => {
    expect(
      compareSnapshotMeta({ generation: 3, nonce: "b" }, { generation: 3, nonce: "a" }),
    ).toBeGreaterThan(0);
  });

  it("different-identity tabs use different IDB names and cannot clobber", async () => {
    setTabLockOwner("alice");
    const aliceName = currentSqliteIdbName();
    await putIdbSnapshot(new Uint8Array([1]), {
      userVersion: 1,
      bundleId: BUNDLE,
      generation: 1,
      nonce: "a",
    });
    setTabLockOwner("bob");
    resetPersistGenerationForTests();
    const bobName = currentSqliteIdbName();
    expect(bobName).not.toBe(aliceName);
    await putIdbSnapshot(new Uint8Array([2]), {
      userVersion: 1,
      bundleId: BUNDLE,
      generation: 1,
      nonce: "b",
    });
    expect(await readBlob(aliceName)).toEqual(new Uint8Array([1]));
    expect(await readBlob(bobName)).toEqual(new Uint8Array([2]));
  });
});
