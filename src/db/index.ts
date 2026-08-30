import { runMigrations } from "./migrations";
import { clearOpenedVfs, openWebSqlite } from "./openWebSqlite";
import type { SqlExecutor } from "./sql";
import { initTabLock, subscribeTabLock } from "@/services/tabLock";

export type { SqlExecutor, SqlExecuteResult, SqlParams, SqlValue } from "./sql";
export { getOpenedVfs } from "./openWebSqlite";
export type { WebSqliteVfs } from "./openWebSqlite";

let _db: SqlExecutor | null = null;
let _injected: SqlExecutor | null = null;

subscribeTabLock((lock) => {
  if (lock.mode !== "readonly" || !_db) return;
  const db = _db as { close?: () => void };
  db.close?.();
  _db = null;
  clearOpenedVfs();
});

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
 * Injected executor wins. Otherwise opens official sqlite3 wasm, applies
 * WAL + foreign_keys, runs schema migrations, and clears `mesh_peers`.
 */
export async function getDb(): Promise<SqlExecutor> {
  if (_injected) return _injected;
  if (_db) return _db;

  const lock = await initTabLock();
  if (lock.mode === "readonly") {
    throw new Error(
      "Hypercolor database is read-only in this tab. Take over writing from the banner to open the database.",
    );
  }

  const db = await openWebSqlite();
  applyConnectionPreamble(db);
  await runMigrations(db);
  db.executeSync("DELETE FROM mesh_peers");
  _db = db;
  return db;
}

/** Closes the database. Primarily used in tests and when a tab loses the writer lock. */
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
