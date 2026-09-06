import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  IDB_KEY,
  IDB_META_KEY,
  IDB_STORE,
  bumpPersistGeneration,
  compareSnapshotMeta,
  currentPersistGeneration,
  currentPersistNonce,
  currentSqliteIdbName,
  putIdbSnapshot,
  resetPersistGenerationForTests,
  sealPersistGenerationInIdb,
} from "../openWebSqlite";
import { resetTabLockForTests, setTabLockOwner } from "@/services/tabLock";

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
  afterEach(() => {
    resetTabLockForTests();
    resetPersistGenerationForTests();
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
    await putIdbSnapshot(new Uint8Array([9]), {
      userVersion: 1,
      bundleId: BUNDLE,
      generation: 1,
      nonce: "old",
    });
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
      await putIdbSnapshot(new Uint8Array([1]), {
        userVersion: 1,
        bundleId: BUNDLE,
        generation: storedGen,
        nonce: "zzzz-old-nonce",
      });
      expect(await readBlob(name)).toEqual(new Uint8Array([9, storedGen]));
    }
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
