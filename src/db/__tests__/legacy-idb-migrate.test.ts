import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDB_KEY,
  IDB_META_KEY,
  IDB_NAME,
  IDB_STORE,
  migrateLegacySqliteSnapshotIfNeeded,
  resetPersistGenerationForTests,
  type SqliteSnapshotMeta,
} from "../openWebSqlite";
import { KeyStore } from "@/services/KeyStore";
import {
  resetTabLockForTests,
  setTabLockModeForTests,
  setTabLockOwner,
} from "@/services/tabLock";

const OWNER = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BUNDLE = "hypercolor-web-schema-v14";

async function openNamed(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function seedSnapshot(
  name: string,
  bytes: Uint8Array,
  meta: SqliteSnapshotMeta,
): Promise<void> {
  const db = await openNamed(name);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      store.put(bytes, IDB_KEY);
      store.put(meta, IDB_META_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function readSnapshot(name: string): Promise<{
  bytes: Uint8Array | null;
  meta: SqliteSnapshotMeta | null;
}> {
  const names = (await indexedDB.databases()).map((entry) => entry.name);
  if (!names.includes(name)) return { bytes: null, meta: null };
  const db = await openNamed(name);
  try {
    return await new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        resolve({ bytes: null, meta: null });
        return;
      }
      const tx = db.transaction(IDB_STORE, "readonly");
      const blobReq = tx.objectStore(IDB_STORE).get(IDB_KEY);
      const metaReq = tx.objectStore(IDB_STORE).get(IDB_META_KEY);
      tx.oncomplete = () => {
        const value = blobReq.result;
        const bytes =
          value instanceof Uint8Array
            ? value
            : value instanceof ArrayBuffer
              ? new Uint8Array(value)
              : null;
        resolve({ bytes, meta: (metaReq.result as SqliteSnapshotMeta | undefined) ?? null });
      };
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function deleteNamed(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onblocked = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function asWriter(owner: string): void {
  setTabLockOwner(owner);
  setTabLockModeForTests("writer");
}

describe("legacy hypercolor-sqlite IDB migration", () => {
  beforeEach(async () => {
    resetTabLockForTests();
    resetPersistGenerationForTests();
    await KeyStore.initKeyStore();
    await KeyStore.clear();
  });

  afterEach(async () => {
    resetTabLockForTests();
    resetPersistGenerationForTests();
    await deleteNamed(IDB_NAME);
    await deleteNamed(`${IDB_NAME}:${OWNER}`);
    await deleteNamed(`${IDB_NAME}:${OTHER}`);
    vi.restoreAllMocks();
  });

  it("legacy-only → migrated + legacy deleted", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await seedSnapshot(IDB_NAME, bytes, {
      userVersion: 14,
      bundleId: BUNDLE,
      generation: 3,
      nonce: "legacy",
      ownerPubky: OWNER,
    });
    asWriter(OWNER);
    await migrateLegacySqliteSnapshotIfNeeded();
    const namespaced = await readSnapshot(`${IDB_NAME}:${OWNER}`);
    expect(namespaced.bytes).toEqual(bytes);
    expect(namespaced.meta?.ownerPubky).toBe(OWNER);
    expect(namespaced.meta?.bundleId).toBe(BUNDLE);
    expect(namespaced.meta?.userVersion).toBe(14);
    expect((await indexedDB.databases()).map((entry) => entry.name)).not.toContain(IDB_NAME);
  });

  it("namespaced exists → legacy untouched", async () => {
    await seedSnapshot(`${IDB_NAME}:${OWNER}`, new Uint8Array([9, 9]), {
      userVersion: 14,
      bundleId: BUNDLE,
      generation: 8,
      nonce: "ns",
      ownerPubky: OWNER,
    });
    await seedSnapshot(IDB_NAME, new Uint8Array([1, 2, 3]), {
      userVersion: 14,
      bundleId: BUNDLE,
      generation: 1,
      nonce: "legacy",
      ownerPubky: OWNER,
    });
    asWriter(OWNER);
    await migrateLegacySqliteSnapshotIfNeeded();
    expect((await readSnapshot(`${IDB_NAME}:${OWNER}`)).bytes).toEqual(new Uint8Array([9, 9]));
    expect((await readSnapshot(IDB_NAME)).bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("legacy blocked by another connection → namespaced still populated, legacy retained, retried on next open", async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    await seedSnapshot(IDB_NAME, bytes, {
      userVersion: 14,
      bundleId: BUNDLE,
      generation: 1,
      nonce: "blk",
      ownerPubky: OWNER,
    });
    const hold = await openNamed(IDB_NAME);
    asWriter(OWNER);
    await migrateLegacySqliteSnapshotIfNeeded();
    expect((await readSnapshot(`${IDB_NAME}:${OWNER}`)).bytes).toEqual(bytes);
    expect((await indexedDB.databases()).map((entry) => entry.name)).toContain(IDB_NAME);
    hold.close();
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    await migrateLegacySqliteSnapshotIfNeeded();
    expect((await readSnapshot(`${IDB_NAME}:${OWNER}`)).bytes).toEqual(bytes);
    expect((await indexedDB.databases()).map((entry) => entry.name)).not.toContain(IDB_NAME);
  });

  it("unsigned tab does nothing", async () => {
    await seedSnapshot(IDB_NAME, new Uint8Array([4, 5]), {
      userVersion: 14,
      bundleId: BUNDLE,
      generation: 1,
      nonce: "u",
    });
    resetTabLockForTests();
    await migrateLegacySqliteSnapshotIfNeeded();
    expect((await readSnapshot(IDB_NAME)).bytes).toEqual(new Uint8Array([4, 5]));
    expect((await indexedDB.databases()).some((entry) => entry.name?.startsWith(`${IDB_NAME}:`))).toBe(
      false,
    );
  });

  it("two-tab race → exactly one migration, no torn meta", async () => {
    const bytes = new Uint8Array([11, 12, 13, 14]);
    await seedSnapshot(IDB_NAME, bytes, {
      userVersion: 14,
      bundleId: BUNDLE,
      generation: 2,
      nonce: "race",
      ownerPubky: OWNER,
    });
    asWriter(OWNER);
    await Promise.all([
      migrateLegacySqliteSnapshotIfNeeded(),
      migrateLegacySqliteSnapshotIfNeeded(),
    ]);
    const namespaced = await readSnapshot(`${IDB_NAME}:${OWNER}`);
    expect(namespaced.bytes).toEqual(bytes);
    expect(namespaced.meta?.bundleId).toBe(BUNDLE);
    expect(namespaced.meta?.userVersion).toBe(14);
    expect(typeof namespaced.meta?.generation).toBe("number");
    expect(typeof namespaced.meta?.nonce).toBe("string");
    expect((await indexedDB.databases()).map((entry) => entry.name)).not.toContain(IDB_NAME);
  });

  it("wrong-owner legacy → not migrated", async () => {
    await seedSnapshot(IDB_NAME, new Uint8Array([3, 3, 3]), {
      userVersion: 14,
      bundleId: BUNDLE,
      generation: 1,
      nonce: "other",
      ownerPubky: OTHER,
    });
    asWriter(OWNER);
    await migrateLegacySqliteSnapshotIfNeeded();
    expect((await readSnapshot(`${IDB_NAME}:${OWNER}`)).bytes).toBeNull();
    expect((await readSnapshot(IDB_NAME)).bytes).toEqual(new Uint8Array([3, 3, 3]));
  });

  it("unidentified legacy migrates only when KeyStore matches and no other namespaced DB exists", async () => {
    await seedSnapshot(IDB_NAME, new Uint8Array([5, 6]), {
      userVersion: 14,
      bundleId: BUNDLE,
      generation: 1,
      nonce: "anon",
    });
    asWriter(OWNER);
    await migrateLegacySqliteSnapshotIfNeeded();
    expect((await readSnapshot(IDB_NAME)).bytes).toEqual(new Uint8Array([5, 6]));

    await KeyStore.setPubky(OWNER);
    asWriter(OWNER);
    await migrateLegacySqliteSnapshotIfNeeded();
    expect((await readSnapshot(`${IDB_NAME}:${OWNER}`)).bytes).toEqual(new Uint8Array([5, 6]));
    expect((await indexedDB.databases()).map((entry) => entry.name)).not.toContain(IDB_NAME);
  });
});
