import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { SQLITE_BUNDLE_ID } from "../bundleId";
import {
  bumpPersistGeneration,
  currentPersistGeneration,
  getIdbSnapshot,
  IDB_META_KEY,
  IDB_NAME,
  IDB_STORE,
  putIdbSnapshot,
} from "../openWebSqlite";

async function readMeta(): Promise<{ generation?: number } | null> {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(IDB_STORE, "readonly");
      const get = tx.objectStore(IDB_STORE).get(IDB_META_KEY);
      get.onsuccess = () => {
        db.close();
        resolve((get.result as { generation?: number } | undefined) ?? null);
      };
      get.onerror = () => reject(get.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe("F2/F5/F6 snapshot generation", () => {
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(IDB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it("refuses a late put with an older generation (repair resurrection race)", async () => {
    const repairedGen = bumpPersistGeneration();
    const fresh = new TextEncoder().encode("REPAIRED-EMPTY");
    await putIdbSnapshot(fresh, {
      userVersion: 13,
      bundleId: SQLITE_BUNDLE_ID,
      generation: repairedGen,
    });

    const staleGen = repairedGen - 1;
    const resurrected = new TextEncoder().encode("OLD-WRITER-ROWS");
    await putIdbSnapshot(resurrected, {
      userVersion: 13,
      bundleId: SQLITE_BUNDLE_ID,
      generation: staleGen,
    });

    const bytes = await getIdbSnapshot();
    expect(bytes ? new TextDecoder().decode(bytes) : null).toBe("REPAIRED-EMPTY");
    const meta = await readMeta();
    expect(meta?.generation).toBe(repairedGen);
  });

  it("accepts a put with the current generation", async () => {
    const gen = currentPersistGeneration();
    const bytes = new TextEncoder().encode("CURRENT");
    await putIdbSnapshot(bytes, {
      userVersion: 13,
      bundleId: SQLITE_BUNDLE_ID,
      generation: gen,
    });
    const stored = await getIdbSnapshot();
    expect(stored ? new TextDecoder().decode(stored) : null).toBe("CURRENT");
  });
});

describe("deleteSqliteSnapshot onblocked", () => {
  it("rejects with SqliteDeleteBlockedError when delete stays blocked", async () => {
    const { deleteSqliteSnapshot } = await import("../openWebSqlite");
    const { SqliteDeleteBlockedError } = await import("../errors");
    const original = indexedDB.deleteDatabase.bind(indexedDB);
    indexedDB.deleteDatabase = (() => {
      const req = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        req.onblocked?.(new Event("blocked") as IDBVersionChangeEvent);
      });
      return req;
    }) as typeof indexedDB.deleteDatabase;
    try {
      await expect(deleteSqliteSnapshot()).rejects.toBeInstanceOf(SqliteDeleteBlockedError);
    } finally {
      indexedDB.deleteDatabase = original;
    }
  });
});
