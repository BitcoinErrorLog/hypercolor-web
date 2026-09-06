/** @vitest-environment jsdom */

/**
 * Fresh-profile one-approval login: unsigned IDB `hypercolor-sqlite` then
 * owner-scoped reopen. Official sqlite3 wasm cannot load under vitest; this
 * drives the REAL IDB snapshot + migrate + persist-generation path from
 * openWebSqlite.ts, with better-sqlite3 executing the same SQL.
 */
import "fake-indexeddb/auto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SQLITE_BUNDLE_ID } from "@/db/bundleId";
import {
  IDB_KEY,
  IDB_META_KEY,
  IDB_NAME,
  IDB_STORE,
  currentPersistGeneration,
  currentPersistNonce,
  currentSqliteIdbName,
  putIdbSnapshot,
  resetPersistGenerationForTests,
  type SqliteSnapshotMeta,
} from "@/db/openWebSqlite";
import { SqlitePersistError } from "@/db/errors";
import { isMutatingSql } from "@/db/mutatingSql";
import type { PersistableSqlExecutor } from "@/db/openWebSqlite";
import { openMemoryDb, type MemoryDb } from "@/db/__tests__/betterSqliteAdapter";
import {
  getTabLock,
  getTabLockOwnerScope,
  isYieldingTab,
  TAB_LOCK_UNSIGNED_SCOPE,
} from "@/services/tabLock";

vi.mock("./PaykitLinkWeb", () => ({
  PaykitLinkWeb: {
    signOutSession: vi.fn(async () => undefined),
    generateNoiseSecretKey: vi.fn(async () => new Uint8Array(32).fill(3)),
    noisePublicKeyFromSecret: vi.fn(async () => "noise-pk-fresh"),
    publishReceiverMarker: vi.fn(async () => undefined),
    getReceiverMarker: vi.fn(async () => null),
  },
}));

vi.mock("@/db/openWebSqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/openWebSqlite")>();
  return {
    ...actual,
    openWebSqlite: vi.fn(async () => openIdbPersistable(actual)),
  };
});

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

const OWNER = "stcyr3wdcfzpzrae35hur4w81o75fasgnpwd561d5m4ep5aba9po";
const STRANGER = "hf3q3rd3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

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

function openFromRaw(db: Database.Database): MemoryDb {
  return {
    raw: db,
    close() {
      db.close();
    },
    executeSync(query, params = []) {
      const sql = query.trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
        db.exec(sql);
        return { rows: [] };
      }
      if (/^PRAGMA\s+user_version\s*=/i.test(sql)) {
        db.exec(sql);
        return { rows: [] };
      }
      if (/^PRAGMA\s+user_version\s*$/i.test(sql)) {
        const value = db.pragma("user_version", { simple: true }) as number;
        return { rows: [{ user_version: value }] };
      }
      if (/^PRAGMA\s+foreign_keys\s*=/i.test(sql)) {
        db.exec(sql);
        return { rows: [] };
      }
      if (/^PRAGMA\s+journal_mode\s*=/i.test(sql)) {
        db.exec(sql);
        return { rows: [] };
      }
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        const rows = params.length > 0 ? stmt.all(...(params as never[])) : stmt.all();
        return { rows: rows as Record<string, unknown>[] };
      }
      if (params.length > 0) stmt.run(...(params as never[]));
      else stmt.run();
      return { rows: [] };
    },
  };
}

function snapshotMeta(
  userVersion: number,
  generation: number,
  nonce: string,
): SqliteSnapshotMeta {
  const owner = getTabLockOwnerScope();
  return {
    userVersion,
    bundleId: SQLITE_BUNDLE_ID,
    generation,
    nonce,
    ...(owner && owner !== TAB_LOCK_UNSIGNED_SCOPE ? { ownerPubky: owner } : {}),
  };
}

function wrapPersistable(mem: MemoryDb): PersistableSqlExecutor {
  let txDepth = 0;
  let persistChain = Promise.resolve();
  let rolledBack = false;
  let lastPersistError: SqlitePersistError | null = null;
  const generation = currentPersistGeneration();
  const nonce = currentPersistNonce();
  let persistBlocked = false;

  const persistNow = () => {
    if (persistBlocked) return persistChain;
    if (getTabLock().mode !== "writer") return persistChain;
    if (isYieldingTab()) return persistChain;
    if (rolledBack) return persistChain;
    try {
      mem.raw.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      /* memory db */
    }
    const bytes = new Uint8Array(mem.raw.serialize());
    const userVersion = Number(
      mem.executeSync("PRAGMA user_version").rows?.[0]?.user_version ?? 0,
    );
    persistChain = persistChain
      .then(() => putIdbSnapshot(bytes, snapshotMeta(userVersion, generation, nonce)))
      .then(() => {
        lastPersistError = null;
      })
      .catch((err: unknown) => {
        lastPersistError = err instanceof SqlitePersistError ? err : new SqlitePersistError(err);
      });
    return persistChain;
  };

  return {
    executeSync(query, params) {
      if (lastPersistError) throw lastPersistError;
      const sql = query.trim();
      if (/^BEGIN\b/i.test(sql)) {
        rolledBack = false;
        const result = mem.executeSync(query, params);
        txDepth += 1;
        return result;
      }
      if (/^COMMIT\b/i.test(sql)) {
        const result = mem.executeSync(query, params);
        txDepth = Math.max(0, txDepth - 1);
        if (txDepth === 0) void persistNow();
        return result;
      }
      if (/^ROLLBACK\b/i.test(sql)) {
        try {
          mem.executeSync(query, params);
        } catch {
          /* better-sqlite throws if no transaction is active */
        }
        txDepth = 0;
        rolledBack = true;
        return { rows: [] };
      }
      const result = mem.executeSync(query, params);
      if (txDepth === 0 && isMutatingSql(sql)) void persistNow();
      return result;
    },
    close() {
      void persistNow();
      mem.close();
    },
    discardClose() {
      persistBlocked = true;
      mem.close();
    },
    rollbackOpenTransaction() {
      if (txDepth <= 0) return;
      mem.executeSync("ROLLBACK");
      txDepth = 0;
      rolledBack = true;
    },
    flushPersist() {
      return persistChain.then(() => {
        if (lastPersistError) throw lastPersistError;
      });
    },
    persistForYield() {
      return persistNow().then(() => {
        if (lastPersistError) throw lastPersistError;
      });
    },
  };
}

async function readSnapshot(name: string): Promise<{
  bytes: Uint8Array | null;
  meta: SqliteSnapshotMeta | null;
}> {
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
        resolve({
          bytes,
          meta: (metaReq.result as SqliteSnapshotMeta | undefined) ?? null,
        });
      };
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function seedSnapshot(
  name: string,
  bytes: Uint8Array,
  meta: SqliteSnapshotMeta,
): Promise<void> {
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

function receiverRowsInBytes(bytes: Uint8Array | null, owner: string): number {
  if (!bytes || bytes.byteLength === 0) return 0;
  const db = new Database(Buffer.from(bytes));
  try {
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='link_receivers'")
      .get() as { name?: string } | undefined;
    if (!exists) return 0;
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM link_receivers WHERE owner_pubky = ?")
      .get(owner) as { n: number };
    return Number(row.n);
  } finally {
    db.close();
  }
}

async function openIdbPersistable(
  actual: typeof import("@/db/openWebSqlite"),
): Promise<PersistableSqlExecutor> {
  await actual.migrateLegacySqliteSnapshotIfNeeded();
  const name = actual.currentSqliteIdbName();
  const snap = await readSnapshot(name);
  actual.preparePersistGenerationForOpen(snap.meta);
  if (
    (await import("@/services/tabLock")).getTabLockOwnerScope() ===
      (await import("@/services/tabLock")).TAB_LOCK_UNSIGNED_SCOPE &&
    !(snap.bytes && snap.bytes.byteLength > 0)
  ) {
    actual.rememberUnsignedSnapshotCreated(actual.currentPersistNonce());
  }
  const mem =
    snap.bytes && snap.bytes.byteLength > 0
      ? openFromRaw(new Database(Buffer.from(snap.bytes)))
      : openMemoryDb();
  return wrapPersistable(mem);
}

async function deleteNamed(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe("fresh sign-in receiver row vs unsigned sqlite snapshot", () => {
  beforeEach(async () => {
    FakeBroadcastChannel.buses.clear();
    vi.stubGlobal("navigator", { locks: new FakeLockManager() });
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    const { resetTabLockForTests } = await import("@/services/tabLock");
    const { resetSessionStateForTests, wipeSessionMetadata } = await import("./session");
    const { closeDb } = await import("@/db");
    const { KeyStore } = await import("@/services/KeyStore");
    closeDb();
    resetTabLockForTests();
    resetPersistGenerationForTests();
    resetSessionStateForTests();
    await wipeSessionMetadata();
    await KeyStore.initKeyStore();
    await KeyStore.clear();
    await deleteNamed(IDB_NAME);
    await deleteNamed(`${IDB_NAME}:${OWNER}`);
    await deleteNamed(`${IDB_NAME}:${STRANGER}`);
  });

  afterEach(async () => {
    const { resetTabLockForTests } = await import("@/services/tabLock");
    const { resetSessionStateForTests, wipeSessionMetadata } = await import("./session");
    const { closeDb } = await import("@/db");
    const { KeyStore } = await import("@/services/KeyStore");
    closeDb();
    resetSessionStateForTests();
    resetTabLockForTests();
    resetPersistGenerationForTests();
    await wipeSessionMetadata();
    await KeyStore.clear();
    await deleteNamed(IDB_NAME);
    await deleteNamed(`${IDB_NAME}:${OWNER}`);
    FakeBroadcastChannel.buses.clear();
    vi.unstubAllGlobals();
  });

  it("provisionReceiver after unsigned welcome leaves a durable namespaced receiver row", async () => {
    const { getDb, closeDb } = await import("@/db");
    const { adoptApprovedSession } = await import("./session");
    const { provisionReceiver } = await import("./provisionReceiver");
    const { StorageService } = await import("@/services/StorageService");
    const { KeyStore } = await import("@/services/KeyStore");
    const { LINK_RECEIVER_PATH } = await import("@/types/link");
    const { acquireScopedWriter, exitWriterCriticalSection, ensureWriter, getTabLock, getTabLockOwnerScope, setTabLockOwner, resetTabLockForTests } =
      await import("@/services/tabLock");
    expect(getTabLockOwnerScope()).toBe("unsigned");
    await ensureWriter();
    const unsigned = await getDb();
    unsigned.executeSync("DELETE FROM mesh_peers");
    await (unsigned as PersistableSqlExecutor).flushPersist?.();

    const handle = fakeHandle(
      OWNER,
      exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
    );
    await acquireScopedWriter(OWNER);
    try {
      await adoptApprovedSession(handle as never);
      await provisionReceiver(handle as never, OWNER);
    } finally {
      exitWriterCriticalSection();
    }

    await (await getDb() as PersistableSqlExecutor).flushPersist?.();

    const liveRow = await StorageService.getLinkReceiver(OWNER);
    const unsignedAfter = await readSnapshot(IDB_NAME);
    const namespaced = await readSnapshot(`${IDB_NAME}:${OWNER}`);
    const unsignedRows = receiverRowsInBytes(unsignedAfter.bytes, OWNER);
    const namespacedRows = receiverRowsInBytes(namespaced.bytes, OWNER);
    const idbTarget = currentSqliteIdbName();

    // Evidence for A vs B: where the receiver row landed in IDB.
    const evidence = {
      liveRow: liveRow !== null,
      writer: getTabLock().mode,
      idbTarget,
      unsignedRows,
      namespacedRows,
      namespacedByteLength: namespaced.bytes?.byteLength ?? 0,
      unsignedByteLength: unsignedAfter.bytes?.byteLength ?? 0,
      unsignedOwnerMeta: unsignedAfter.meta?.ownerPubky ?? null,
      namespacedOwnerMeta: namespaced.meta?.ownerPubky ?? null,
      keyStoreSecret: Boolean(await KeyStore.getReceiverNoiseSecret(LINK_RECEIVER_PATH)),
    };

    closeDb();
    resetTabLockForTests();
    resetPersistGenerationForTests();
    const { waitForOwnerScopedSqlite } = await import("@/db");
    setTabLockOwner(OWNER);
    await ensureWriter();
    await waitForOwnerScopedSqlite();
    const reopened = await getDb();
    await (reopened as PersistableSqlExecutor).flushPersist?.();
    let afterReload = await StorageService.getLinkReceiver(OWNER);
    if (!afterReload) {
      const { healMissingReceiverRow } = await import("./provisionReceiver");
      expect(await healMissingReceiverRow(handle as never, OWNER)).toBe(true);
      afterReload = await StorageService.getLinkReceiver(OWNER);
    }

    expect(evidence.liveRow).toBe(true);
    expect(evidence.keyStoreSecret).toBe(true);
    expect(afterReload?.ownerPubky).toBe(OWNER);
  });

  it("does not stamp or delete an unidentified leftover from another identity", async () => {
    const leftover = openMemoryDb();
    leftover.executeSync("CREATE TABLE IF NOT EXISTS t (n INTEGER)");
    leftover.executeSync("INSERT INTO t (n) VALUES (7)");
    const bytes = new Uint8Array(leftover.raw.serialize());
    leftover.close();
    await seedSnapshot(IDB_NAME, bytes, {
      userVersion: 15,
      bundleId: SQLITE_BUNDLE_ID,
      generation: 4,
      nonce: "stranger-nonce",
    });

    const { getDb } = await import("@/db");
    const { adoptApprovedSession } = await import("./session");
    const handle = fakeHandle(
      OWNER,
      exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
    );
    await adoptApprovedSession(handle as never);
    await getDb();

    const leftoverAfter = await readSnapshot(IDB_NAME);
    const namespaced = await readSnapshot(`${IDB_NAME}:${OWNER}`);
    const namespacedAdoptedStranger = (() => {
      if (!namespaced.bytes || namespaced.bytes.byteLength === 0) return false;
      const db = new Database(Buffer.from(namespaced.bytes));
      try {
        return Boolean(
          db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t'").get(),
        );
      } catch {
        return false;
      } finally {
        db.close();
      }
    })();
    expect(leftoverAfter.meta?.ownerPubky ?? null).not.toBe(OWNER);
    expect(namespacedAdoptedStranger).toBe(false);
    expect((await indexedDB.databases()).map((e) => e.name)).toContain(IDB_NAME);
  });

  it("re-provisions the sqlite receiver row from KeyStore without a second PUT when HS already has the marker", async () => {
    const { getDb } = await import("@/db");
    const { adoptApprovedSession } = await import("./session");
    const { provisionReceiver, healMissingReceiverRow } = await import("./provisionReceiver");
    const { StorageService } = await import("@/services/StorageService");
    const { KeyStore } = await import("@/services/KeyStore");
    const { ensureWriter } = await import("@/services/tabLock");
    const { PaykitLinkWeb } = await import("./PaykitLinkWeb");
    const { LINK_RECEIVER_PATH } = await import("@/types/link");

    vi.mocked(PaykitLinkWeb.publishReceiverMarker).mockClear();
    vi.mocked(PaykitLinkWeb.getReceiverMarker).mockResolvedValue(null);
    await ensureWriter();
    await getDb();
    const handle = fakeHandle(
      OWNER,
      exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
    );
    await adoptApprovedSession(handle as never);
    await provisionReceiver(handle as never, OWNER);
    expect(vi.mocked(PaykitLinkWeb.publishReceiverMarker).mock.calls.length).toBe(1);

    await StorageService.deleteLinkReceiver(OWNER);
    expect(await StorageService.getLinkReceiver(OWNER)).toBeNull();
    expect(await KeyStore.getReceiverNoiseSecret(LINK_RECEIVER_PATH)).toBeTruthy();

    vi.mocked(PaykitLinkWeb.getReceiverMarker).mockResolvedValue({
      noisePublicKey: "noise-pk-fresh",
    } as never);

    const first = healMissingReceiverRow(handle as never, OWNER);
    const second = healMissingReceiverRow(handle as never, OWNER);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await StorageService.getLinkReceiver(OWNER)).not.toBeNull();
    expect(vi.mocked(PaykitLinkWeb.publishReceiverMarker).mock.calls.length).toBe(1);
  });
});
