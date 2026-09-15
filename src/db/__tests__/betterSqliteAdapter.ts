import Database from "better-sqlite3";
import type { SqlExecutor, SqlParams, SqlValue } from "../sql";

export type MemoryDb = SqlExecutor & {
  raw: Database.Database;
  close: () => void;
};

/**
 * Thin adapter so the REAL migration SQL runs against SQLite in Node.
 * Official sqlite3 wasm / OPFS cannot load under vitest; better-sqlite3
 * executes the identical SQL strings.
 */
function wrapBetterSqlite(db: Database.Database): MemoryDb {
  return {
    raw: db,
    close() {
      db.close();
    },
    executeSync(query: string, params: SqlParams | SqlValue[] = []) {
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
      if (/^PRAGMA\s+foreign_keys\s*$/i.test(sql)) {
        const value = db.pragma("foreign_keys", { simple: true }) as number;
        return { rows: [{ foreign_keys: value }] };
      }
      if (/^PRAGMA\s+journal_mode\s*=/i.test(sql)) {
        db.exec(sql);
        return { rows: [] };
      }
      if (/^PRAGMA\s+journal_mode\s*$/i.test(sql)) {
        const value = db.pragma("journal_mode", { simple: true }) as string;
        return { rows: [{ journal_mode: value }] };
      }
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
        return { rows: rows as Record<string, unknown>[] };
      }
      if (params.length > 0) stmt.run(...params);
      else stmt.run();
      return { rows: [] };
    },
  };
}

export function openMemoryDb(): MemoryDb {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return wrapBetterSqlite(db);
}

/** File-backed DB so `PRAGMA journal_mode = WAL` actually sticks. */
export function openFileDb(filePath: string): MemoryDb {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return wrapBetterSqlite(db);
}
