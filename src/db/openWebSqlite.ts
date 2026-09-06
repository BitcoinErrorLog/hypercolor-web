import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { SQLITE_BUNDLE_ID } from "./bundleId";
import { CURRENT_VERSION } from "./migrations";
import {
  SqliteDeleteBlockedError,
  SqlitePersistError,
  SqliteSnapshotIntegrityError,
  SQLITE_BUNDLE_CHANGED_EVENT,
  SQLITE_PERSIST_FAILED_EVENT,
} from "./errors";
import { isMutatingSql } from "./mutatingSql";
import { wrapOo1Db, type ClosableSqlExecutor } from "./oo1Executor";
import { getTabLock } from "@/services/tabLock";

export type { ClosableSqlExecutor } from "./oo1Executor";
export { isMutatingSql } from "./mutatingSql";

export type WebSqliteVfs = "idb-snapshot" | "kvvfs";

export const IDB_NAME = "hypercolor-sqlite";
export const IDB_STORE = "sqlite";
export const IDB_KEY = "hypercolor.db";
export const IDB_META_KEY = "hypercolor.db.meta";

let openedVfs: WebSqliteVfs | null = null;

export function getOpenedVfs(): WebSqliteVfs | null {
  return openedVfs;
}

export type SqliteSnapshotMeta = {
  userVersion: number;
  bundleId: string;
  generation: number;
};

let persistGeneration = 1;

export function currentPersistGeneration(): number {
  return persistGeneration;
}

export function bumpPersistGeneration(): number {
  persistGeneration = Math.max(persistGeneration + 1, Date.now());
  return persistGeneration;
}

type SqliteInit = (config?: {
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
  locateFile?: (file: string, prefix?: string) => string;
}) => Promise<Sqlite3Static>;

async function loadOfficialSqlite3(): Promise<Sqlite3Static> {
  const sqlite3InitModule = (await import("@sqlite.org/sqlite-wasm"))
    .default as SqliteInit;
  return sqlite3InitModule({
    print: () => undefined,
    printErr: (msg) => {
      console.error(msg);
    },
    locateFile: (file) => {
      if (file.endsWith(".wasm")) return "/sqlite3.wasm";
      return `/${file}`;
    },
  });
}

export type PersistableSqlExecutor = ClosableSqlExecutor & {
  flushPersist?: () => Promise<void>;
  persistForYield?: () => Promise<void>;
  discardClose?: () => void;
  rollbackOpenTransaction?: () => void;
};

function emitPersistFailed(err: SqlitePersistError): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SQLITE_PERSIST_FAILED_EVENT, { detail: err.message }));
}

function wrapIdbSnapshot(
  sqlite3: Sqlite3Static,
  db: Database,
): PersistableSqlExecutor {
  let txDepth = 0;
  let persistChain = Promise.resolve();
  let rolledBack = false;
  let lastPersistError: SqlitePersistError | null = null;
  const generation = persistGeneration;
  let persistBlocked = false;

  const persistNow = (reason: "commit" | "autocommit" | "close") => {
    if (persistBlocked) return persistChain;
    if (getTabLock().mode !== "writer") return persistChain;
    if (rolledBack) return persistChain;
    if (!db.pointer) return persistChain;
    const bytes = sqlite3.capi.sqlite3_js_db_export(db.pointer);
    const versionRows = db.exec({
      sql: "PRAGMA user_version",
      rowMode: "object",
      returnValue: "resultRows",
    }) as Array<{ user_version?: number }>;
    const userVersion = Number(versionRows?.[0]?.user_version ?? 0);
    persistChain = persistChain
      .then(() =>
        putIdbSnapshot(bytes, {
          userVersion,
          bundleId: SQLITE_BUNDLE_ID,
          generation,
        }),
      )
      .then(() => {
        lastPersistError = null;
      })
      .catch((err: unknown) => {
        lastPersistError = new SqlitePersistError(err);
        emitPersistFailed(lastPersistError);
      });
    void reason;
    return persistChain;
  };

  const inner = wrapOo1Db(db);

  return {
    executeSync(query, params) {
      if (lastPersistError) throw lastPersistError;
      const sql = query.trim();
      if (/^BEGIN\b/i.test(sql)) {
        rolledBack = false;
        const result = inner.executeSync(query, params);
        txDepth += 1;
        return result;
      }
      if (/^COMMIT\b/i.test(sql)) {
        const result = inner.executeSync(query, params);
        txDepth = Math.max(0, txDepth - 1);
        if (txDepth === 0) void persistNow("commit");
        return result;
      }
      if (/^ROLLBACK\b/i.test(sql)) {
        const result = inner.executeSync(query, params);
        txDepth = 0;
        rolledBack = true;
        return result;
      }
      const result = inner.executeSync(query, params);
      if (txDepth === 0 && isMutatingSql(sql)) void persistNow("autocommit");
      return result;
    },
    close() {
      if (getTabLock().mode === "writer" && !rolledBack && !persistBlocked) {
        void persistNow("close");
      }
      inner.close();
    },
    rollbackOpenTransaction() {
      if (txDepth <= 0) return;
      inner.executeSync("ROLLBACK");
      txDepth = 0;
      rolledBack = true;
    },
    discardClose() {
      persistBlocked = true;
      inner.close();
    },
    flushPersist() {
      return persistChain.then(() => {
        if (lastPersistError) throw lastPersistError;
      });
    },
    persistForYield() {
      void persistNow("close");
      return persistChain.then(() => {
        if (lastPersistError) throw lastPersistError;
      });
    },
  };
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("indexedDB.open failed"));
  });
}

function decodeSnapshotBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

export async function getIdbSnapshot(): Promise<Uint8Array | null> {
  const { bytes } = await getIdbSnapshotAndMeta();
  return bytes;
}

async function getIdbSnapshotAndMeta(): Promise<{
  bytes: Uint8Array | null;
  meta: SqliteSnapshotMeta | null;
}> {
  const db = await openIdb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const blobReq = store.get(IDB_KEY);
      const metaReq = store.get(IDB_META_KEY);
      tx.oncomplete = () => {
        const raw = metaReq.result;
        const meta =
          raw &&
          typeof raw === "object" &&
          typeof (raw as SqliteSnapshotMeta).bundleId === "string" &&
          typeof (raw as SqliteSnapshotMeta).userVersion === "number"
            ? {
                userVersion: Number((raw as SqliteSnapshotMeta).userVersion),
                bundleId: String((raw as SqliteSnapshotMeta).bundleId),
                generation: Number((raw as SqliteSnapshotMeta).generation ?? 0),
              }
            : null;
        resolve({ bytes: decodeSnapshotBytes(blobReq.result), meta });
      };
      tx.onerror = () =>
        reject(tx.error ?? new Error("indexedDB get failed"));
    });
  } finally {
    db.close();
  }
}

export async function putIdbSnapshot(
  bytes: Uint8Array,
  meta: SqliteSnapshotMeta,
): Promise<void> {
  const db = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const existingReq = store.get(IDB_META_KEY);
      existingReq.onsuccess = () => {
        const existing = existingReq.result as SqliteSnapshotMeta | undefined;
        if (
          existing &&
          typeof existing.generation === "number" &&
          existing.generation > meta.generation
        ) {
          return;
        }
        store.put(bytes, IDB_KEY);
        store.put(meta, IDB_META_KEY);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("indexedDB put failed"));
    });
  } finally {
    db.close();
  }
}

function hydrateMemoryDb(
  sqlite3: Sqlite3Static,
  bytes: Uint8Array | null,
): Database {
  const db = new sqlite3.oo1.DB(":memory:", "c");
  if (!bytes || bytes.byteLength === 0) return db;
  const pointer = db.pointer;
  if (pointer === undefined) {
    db.close();
    throw new Error("sqlite3 memory db has no pointer");
  }
  const wasmPtr = sqlite3.wasm.allocFromTypedArray(bytes);
  const rc = sqlite3.capi.sqlite3_deserialize(
    pointer,
    "main",
    wasmPtr,
    bytes.byteLength,
    bytes.byteLength,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
      sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
  );
  db.checkRc(rc);
  return db;
}

function pragmaUserVersion(db: Database): number {
  const versionRows = db.exec({
    sql: "PRAGMA user_version",
    rowMode: "object",
    returnValue: "resultRows",
  }) as Array<{ user_version?: number }>;
  return Number(versionRows?.[0]?.user_version ?? 0);
}

/**
 * Hydrate integrity: refuse only on meta/blob user_version disagreement
 * (corruption) or blob newer than this build (downgrade). bundleId mismatch
 * is informational — runMigrations upgrades a supported user_version.
 */
export function assertHydrateIntegrity(
  meta: SqliteSnapshotMeta,
  blobVersion: number,
  options?: { currentVersion?: number; sqliteBundleId?: string },
): void {
  const currentVersion = options?.currentVersion ?? CURRENT_VERSION;
  const sqliteBundleId = options?.sqliteBundleId ?? SQLITE_BUNDLE_ID;
  if (meta.bundleId !== sqliteBundleId) {
    console.info("[hypercolor-sqlite] snapshot bundleId changed", {
      from: meta.bundleId,
      to: sqliteBundleId,
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(SQLITE_BUNDLE_CHANGED_EVENT, {
          detail: { from: meta.bundleId, to: sqliteBundleId },
        }),
      );
    }
  }
  if (meta.userVersion !== blobVersion || blobVersion > currentVersion) {
    throw new SqliteSnapshotIntegrityError();
  }
}

async function openIdbSnapshotVfs(
  sqlite3: Sqlite3Static,
): Promise<PersistableSqlExecutor> {
  const { bytes, meta } = await getIdbSnapshotAndMeta();
  const db = hydrateMemoryDb(sqlite3, bytes);
  if (bytes && bytes.byteLength > 0 && meta) {
    const blobVersion = pragmaUserVersion(db);
    try {
      assertHydrateIntegrity(meta, blobVersion);
    } catch (err) {
      db.close();
      if (err instanceof SqliteSnapshotIntegrityError && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(SQLITE_PERSIST_FAILED_EVENT, { detail: err.message }),
        );
      }
      throw err;
    }
  }
  return wrapIdbSnapshot(sqlite3, db);
}

function openKvvfs(sqlite3: Sqlite3Static): PersistableSqlExecutor {
  const db = new sqlite3.oo1.JsStorageDb("local");
  const inner = wrapOo1Db(db);
  return {
    ...inner,
    flushPersist: async () => undefined,
    persistForYield: async () => undefined,
    discardClose() {
      inner.close();
    },
    rollbackOpenTransaction() {
      try {
        inner.executeSync("ROLLBACK");
      } catch {
        /* no open transaction */
      }
    },
  };
}

/**
 * Opens official sqlite3 wasm with the P1 VFS policy:
 * 1. Official sqlite3 memory + IndexedDB snapshot when IDB exists.
 * 2. Official kvvfs (`localStorage`) last. Tiny (~5MB); only if IDB is gone.
 *
 * `opfs-sahpool` is deliberately not used: its exclusive SyncAccessHandles
 * survive the document that opened them, so the next document's `getDb()`
 * blocks forever behind handles the previous page still holds.
 */
export async function openWebSqlite(): Promise<PersistableSqlExecutor> {
  if (typeof window === "undefined") {
    throw new Error(
      "Web SQLite requires a browser, or inject an executor with setDbExecutor() / setDbForTests().",
    );
  }

  const sqlite3 = await loadOfficialSqlite3();

  if (typeof indexedDB !== "undefined") {
    const executor = await openIdbSnapshotVfs(sqlite3);
    openedVfs = "idb-snapshot";
    return executor;
  }

  if (typeof sqlite3.oo1.JsStorageDb === "function") {
    const executor = openKvvfs(sqlite3);
    openedVfs = "kvvfs";
    return executor;
  }

  throw new Error("No SQLite VFS available in this browser");
}

export function clearOpenedVfs(): void {
  openedVfs = null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function deleteIdbDatabaseOnce(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(IDB_NAME);
    req.onsuccess = () => resolve();
    req.onblocked = () =>
      reject(new SqliteDeleteBlockedError());
    req.onerror = () =>
      reject(req.error ?? new Error("indexedDB.deleteDatabase failed"));
  });
}

/** Deletes the IDB sqlite snapshot and kvvfs localStorage keys. Keeps KeyStore. */
export async function deleteSqliteSnapshot(): Promise<void> {
  if (typeof indexedDB !== "undefined") {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await deleteIdbDatabaseOnce();
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
        if (!(err instanceof SqliteDeleteBlockedError)) throw err;
        await delay(40 * (attempt + 1));
      }
    }
    if (lastError) throw lastError;
  }
  if (typeof localStorage !== "undefined") {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.toLowerCase().startsWith("kvvfs")) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  }
}
