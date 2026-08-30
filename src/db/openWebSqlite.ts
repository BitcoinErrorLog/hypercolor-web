import type { Database, SAHPoolUtil, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { wrapOo1Db, type ClosableSqlExecutor } from "./oo1Executor";

export type WebSqliteVfs = "opfs-sahpool" | "idb-snapshot" | "kvvfs";

const SAHPOOL_DIRECTORY = "hypercolor-sahpool";
const SAHPOOL_DB_PATH = "/hypercolor.db";
const IDB_NAME = "hypercolor-sqlite";
const IDB_STORE = "sqlite";
const IDB_KEY = "hypercolor.db";

let openedVfs: WebSqliteVfs | null = null;
let sahPool: SAHPoolUtil | null = null;

export function getOpenedVfs(): WebSqliteVfs | null {
  return openedVfs;
}

export function canUseOpfsSahPool(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.storage?.getDirectory !== "function") return false;
  if (typeof FileSystemFileHandle === "undefined") return false;
  const proto = FileSystemFileHandle.prototype as FileSystemFileHandle & {
    createSyncAccessHandle?: () => Promise<unknown>;
  };
  return typeof proto.createSyncAccessHandle === "function";
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

function isMutatingSql(sql: string): boolean {
  const trimmed = sql.trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(trimmed)) return false;
  if (/^SELECT\b/i.test(trimmed)) return false;
  if (/^PRAGMA\s+(?!user_version\s*=)/i.test(trimmed)) return false;
  return true;
}

function wrapIdbSnapshot(
  sqlite3: Sqlite3Static,
  db: Database,
): ClosableSqlExecutor {
  let txDepth = 0;
  let persistChain = Promise.resolve();

  const persistNow = () => {
    if (!db.pointer) return persistChain;
    const bytes = sqlite3.capi.sqlite3_js_db_export(db.pointer);
    persistChain = persistChain
      .then(() => putIdbSnapshot(bytes))
      .catch((err: unknown) => {
        console.error("hypercolor sqlite IDB persist failed", err);
      });
    return persistChain;
  };

  const inner = wrapOo1Db(db, () => {
    void persistNow();
  });

  return {
    executeSync(query, params) {
      const sql = query.trim();
      if (/^BEGIN\b/i.test(sql)) {
        const result = inner.executeSync(query, params);
        txDepth += 1;
        return result;
      }
      if (/^COMMIT\b/i.test(sql)) {
        const result = inner.executeSync(query, params);
        txDepth = Math.max(0, txDepth - 1);
        if (txDepth === 0) void persistNow();
        return result;
      }
      if (/^ROLLBACK\b/i.test(sql)) {
        const result = inner.executeSync(query, params);
        txDepth = 0;
        void persistNow();
        return result;
      }
      const result = inner.executeSync(query, params);
      if (txDepth === 0 && isMutatingSql(sql)) void persistNow();
      return result;
    },
    close() {
      void persistNow();
      inner.close();
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

async function getIdbSnapshot(): Promise<Uint8Array | null> {
  const db = await openIdb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => {
        const value = req.result;
        if (value instanceof Uint8Array) resolve(value);
        else if (value instanceof ArrayBuffer) resolve(new Uint8Array(value));
        else resolve(null);
      };
      req.onerror = () =>
        reject(req.error ?? new Error("indexedDB get failed"));
    });
  } finally {
    db.close();
  }
}

async function putIdbSnapshot(bytes: Uint8Array): Promise<void> {
  const db = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("indexedDB put failed"));
      tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
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

async function openSahPool(
  sqlite3: Sqlite3Static,
): Promise<ClosableSqlExecutor> {
  const pool = await sqlite3.installOpfsSAHPoolVfs({
    name: "opfs-sahpool",
    directory: SAHPOOL_DIRECTORY,
    initialCapacity: 8,
  });
  sahPool = pool;
  const db = new pool.OpfsSAHPoolDb(SAHPOOL_DB_PATH);
  // WAL on OPFS needs exclusive locking (official sqlite wasm docs).
  db.exec("PRAGMA locking_mode = exclusive");
  return wrapOo1Db(db, () => {
    try {
      if (sahPool && !sahPool.isPaused()) sahPool.pauseVfs();
    } catch (err) {
      console.error("hypercolor sahpool pause failed", err);
    }
    sahPool = null;
  });
}

async function openIdbSnapshotVfs(
  sqlite3: Sqlite3Static,
): Promise<ClosableSqlExecutor> {
  const bytes = await getIdbSnapshot();
  const db = hydrateMemoryDb(sqlite3, bytes);
  return wrapIdbSnapshot(sqlite3, db);
}

function openKvvfs(sqlite3: Sqlite3Static): ClosableSqlExecutor {
  const db = new sqlite3.oo1.JsStorageDb("local");
  return wrapOo1Db(db);
}

/**
 * Opens official sqlite3 wasm with the P1 VFS policy:
 * 1. `opfs-sahpool` when OPFS SyncAccessHandle is available (no COOP/COEP).
 * 2. Official sqlite3 memory + IndexedDB snapshot when IDB exists. This is
 *    the executeSync-compatible stand-in for wa-sqlite IDBBatchAtomicVFS
 *    (that VFS is async-only and cannot implement `SqlExecutor.executeSync`
 *    without SharedArrayBuffer).
 * 3. Official kvvfs (`localStorage`) last. Tiny (~5MB); only if IDB is gone.
 */
export async function openWebSqlite(): Promise<ClosableSqlExecutor> {
  if (typeof window === "undefined") {
    throw new Error(
      "Web SQLite requires a browser, or inject an executor with setDbExecutor() / setDbForTests().",
    );
  }

  const sqlite3 = await loadOfficialSqlite3();

  if (canUseOpfsSahPool()) {
    try {
      const executor = await openSahPool(sqlite3);
      openedVfs = "opfs-sahpool";
      return executor;
    } catch (err) {
      console.warn(
        "opfs-sahpool unavailable; falling back to IDB snapshot",
        err,
      );
    }
  }

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
  if (sahPool) {
    try {
      if (!sahPool.isPaused()) sahPool.pauseVfs();
    } catch {
      // Already closed or not held.
    }
    sahPool = null;
  }
  openedVfs = null;
}
