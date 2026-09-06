import { runMigrations } from "./migrations";
import { isMutatingSql } from "./mutatingSql";
import { ReadOnlyTabError } from "./errors";
import {
  clearOpenedVfs,
  openWebSqlite,
  sealPersistGenerationInIdb,
  type PersistableSqlExecutor,
} from "./openWebSqlite";
import type { SqlExecutor } from "./sql";
import {
  consumeTakeoverRefresh,
  getTabLock,
  getTabLockOwnerScope,
  initTabLock,
  isTakeoverInProgress,
  isWriterSurfaceReady,
  isYieldingTab,
  markWriterSurfaceReady,
  setBeforeWriterYield,
  subscribeTabLock,
} from "@/services/tabLock";

export type { SqlExecutor, SqlExecuteResult, SqlParams, SqlValue } from "./sql";
export { getOpenedVfs, deleteSqliteSnapshot } from "./openWebSqlite";
export type { WebSqliteVfs } from "./openWebSqlite";
export { ReadOnlyTabError, SqlitePersistError, SqliteSnapshotIntegrityError, SqliteDeleteBlockedError, SqliteRepairIncompleteError, isReadOnlyTabError, isSqlitePersistError, isSqliteSnapshotIntegrityError } from "./errors";

let _db: PersistableSqlExecutor | SqlExecutor | null = null;
let _injected: SqlExecutor | null = null;
let _opening: Promise<SqlExecutor> | null = null;
let _refreshing = false;

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    closeDb();
  });
  // Read-only tabs keep an in-memory copy of the last IDB snapshot. There is
  // no BroadcastChannel in this codebase for sqlite; visibility/focus is the
  // existing document lifecycle the rest of the app already uses, so we
  // re-hydrate from IDB there instead of adding a second bus.
  const refreshIfReadonly = () => {
    if (getTabLock().mode !== "readonly") return;
    void refreshReadonlySnapshot();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshIfReadonly();
  });
  window.addEventListener("focus", refreshIfReadonly);
}

setBeforeWriterYield(async () => {
  const persistable = _db as PersistableSqlExecutor | null;
  if (!persistable || _injected) return;
  persistable.rollbackOpenTransaction?.();
  await persistable.persistForYield?.();
});

let lastOwnerScope = getTabLockOwnerScope();

subscribeTabLock((lock) => {
  if (_injected) return;
  const owner = getTabLockOwnerScope();
  if (owner !== lastOwnerScope) {
    lastOwnerScope = owner;
    if (_db || _opening) {
      discardCloseDb();
      void getDb();
    }
  }
  if (isTakeoverInProgress()) return;
  if (lock.mode === "writer") {
    if (!consumeTakeoverRefresh()) return;
    void (async () => {
      try {
        await sealPersistGenerationInIdb();
        await refreshReadonlySnapshot();
      } finally {
        markWriterSurfaceReady();
      }
    })();
    return;
  }
  if (!_db) return;
  const persistable = _db as PersistableSqlExecutor;
  if (typeof persistable.rollbackOpenTransaction === "function") {
    persistable.rollbackOpenTransaction();
  }
});

function isReadonlyBlockedSql(query: string): boolean {
  const trimmed = query.trim();
  if (/^BEGIN\b/i.test(trimmed)) return true;
  return isMutatingSql(query);
}

function guardMutations(db: PersistableSqlExecutor | SqlExecutor): PersistableSqlExecutor {
  const persistable = db as PersistableSqlExecutor;
  let txDepth = 0;
  return {
    executeSync(query, params) {
      if (
        (getTabLock().mode === "readonly" ||
          isYieldingTab() ||
          !isWriterSurfaceReady()) &&
        isReadonlyBlockedSql(query)
      ) {
        const err = new ReadOnlyTabError();
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("hypercolor-readonly-write", { detail: err.message }),
          );
        }
        throw err;
      }
      const sql = query.trim();
      const result = db.executeSync(query, params);
      if (/^BEGIN\b/i.test(sql)) txDepth += 1;
      else if (/^COMMIT\b/i.test(sql)) txDepth = Math.max(0, txDepth - 1);
      else if (/^ROLLBACK\b/i.test(sql)) txDepth = 0;
      return result;
    },
    close() {
      persistable.close?.();
    },
    discardClose() {
      if (typeof persistable.discardClose === "function") persistable.discardClose();
      else persistable.close?.();
    },
    rollbackOpenTransaction() {
      if (txDepth <= 0) return;
      db.executeSync("ROLLBACK");
      txDepth = 0;
    },
    flushPersist: async () => {
      await persistable.flushPersist?.();
    },
    persistForYield: async () => {
      await persistable.persistForYield?.();
    },
  };
}

/**
 * Production inject: set the executor before the first `getDb()`.
 * Pass `null` to clear (also drops the cached production handle).
 */
export function setDbExecutor(db: SqlExecutor | null): void {
  _injected = db;
  if (db === null) _db = null;
}

/**
 * Test seam (mobile name). Alias of `setDbExecutor` so ported tests work.
 */
export function setDbForTests(db: SqlExecutor | null): void {
  setDbExecutor(db);
}

/** WAL + foreign keys, matching mobile `getDb()` connection preamble. */
export function applyConnectionPreamble(db: SqlExecutor): void {
  db.executeSync("PRAGMA journal_mode = WAL");
  db.executeSync("PRAGMA foreign_keys = ON");
}

/**
 * Returns the singleton SQLite executor.
 * Writer and read-only tabs both open the snapshot. Mutations in a
 * non-writer tab throw ReadOnlyTabError.
 */
export async function getDb(): Promise<SqlExecutor> {
  // Injected executors are test/production seams that already own locking.
  if (_injected) return _injected;
  if (_db) return _db;
  if (_opening) return _opening;

  _opening = (async () => {
    try {
      await initTabLock();
      const db = await openWebSqlite();
      applyConnectionPreamble(db);
      const writer = getTabLock().mode === "writer";
      await runMigrations(db);
      if (writer) {
        db.executeSync("DELETE FROM mesh_peers");
        await db.flushPersist?.();
      }
      _db = guardMutations(db);
      return _db;
    } finally {
      _opening = null;
    }
  })();
  return _opening;
}

export async function refreshReadonlySnapshot(): Promise<void> {
  if (_injected || _refreshing) return;
  _refreshing = true;
  try {
    const current = _db as PersistableSqlExecutor | null;
    if (typeof current?.discardClose === "function") current.discardClose();
    else current?.close?.();
    _db = null;
    clearOpenedVfs();
    await getDb();
  } finally {
    _refreshing = false;
  }
}

/** Closes without persisting. Used on takeover refresh and Repair. */
export function discardCloseDb(): void {
  if (_injected) {
    _injected = null;
    return;
  }
  const db = _db as PersistableSqlExecutor | null;
  if (typeof db?.discardClose === "function") db.discardClose();
  else db?.close?.();
  _db = null;
  clearOpenedVfs();
}

/** Closes the database. Writer tabs persist on close; used on pagehide. */
export function closeDb(): void {
  if (_injected) {
    _injected = null;
    return;
  }
  const db = _db as { close?: () => void } | null;
  db?.close?.();
  _db = null;
  clearOpenedVfs();
}

if (typeof window !== "undefined" && __HYPERCOLOR_E2E_HARNESS__) {
  const host = window as Window & {
    __hypercolorTryDbWrite?: () => Promise<{ ok: boolean; message: string }>;
  };
  host.__hypercolorTryDbWrite = async () => {
    const db = await getDb();
    try {
      db.executeSync("DELETE FROM mesh_peers");
      return { ok: true, message: "ok" };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
