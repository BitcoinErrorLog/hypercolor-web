// Copied from BitcoinErrorLog/hypercolor src/db/migrations.ts
// pin 6185a6a8e6bf3a52831515cb85131a7020704396
import {
  SCHEMA_V1_STATEMENTS,
  SCHEMA_V2_STATEMENTS,
  SCHEMA_V3_STATEMENTS,
  SCHEMA_V4_STATEMENTS,
  SCHEMA_V5_STATEMENTS,
  SCHEMA_V6_STATEMENTS,
  SCHEMA_V7_STATEMENTS,
  SCHEMA_V8_STATEMENTS,
  SCHEMA_V9_STATEMENTS,
  SCHEMA_V10_STATEMENTS,
  SCHEMA_V11_STATEMENTS,
  SCHEMA_V12_STATEMENTS,
  SCHEMA_V13_STATEMENTS,
  SCHEMA_V14_STATEMENTS,
  SCHEMA_V15_STATEMENTS,
} from './schema';
import type { SqlExecutor } from './sql';

/**
 * Migration runner for Hypercolor SQLite database.
 *
 * Each migration is a list of SQL statements applied atomically inside a
 * transaction. Versions are stored in the SQLite user_version pragma.
 *
 * Rules:
 * - Never modify an existing migration's meaning. Add a new one instead.
 * - Statements are applied with idempotent guards (pragma table_info for
 *   ADD COLUMN, skip RENAME when the destination already exists).
 * - After adding a migration, bump CURRENT_VERSION.
 *
 * Bundled @sqlite.org/sqlite-wasm is 3.53.x. SQLite still has no
 * `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, so we guard via table_info.
 */

const CURRENT_VERSION = 15;

type Migration = {
  version: number;
  statements: readonly string[];
};

const MIGRATIONS: readonly Migration[] = [
  { version: 1, statements: SCHEMA_V1_STATEMENTS },
  { version: 2, statements: SCHEMA_V2_STATEMENTS },
  { version: 3, statements: SCHEMA_V3_STATEMENTS },
  { version: 4, statements: SCHEMA_V4_STATEMENTS },
  { version: 5, statements: SCHEMA_V5_STATEMENTS },
  { version: 6, statements: SCHEMA_V6_STATEMENTS },
  { version: 7, statements: SCHEMA_V7_STATEMENTS },
  { version: 8, statements: SCHEMA_V8_STATEMENTS },
  { version: 9, statements: SCHEMA_V9_STATEMENTS },
  { version: 10, statements: SCHEMA_V10_STATEMENTS },
  { version: 11, statements: SCHEMA_V11_STATEMENTS },
  { version: 12, statements: SCHEMA_V12_STATEMENTS },
  { version: 13, statements: SCHEMA_V13_STATEMENTS },
  { version: 14, statements: SCHEMA_V14_STATEMENTS },
  { version: 15, statements: SCHEMA_V15_STATEMENTS },
];

export function tableExists(db: SqlExecutor, table: string): boolean {
  const result = db.executeSync(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [table],
  );
  return (result.rows?.length ?? 0) > 0;
}

export function columnExists(db: SqlExecutor, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  const result = db.executeSync(`PRAGMA table_info(${table})`);
  return (result.rows ?? []).some((row) => String(row.name) === column);
}

const ADD_COLUMN = /^ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)\b/i;
const RENAME_TABLE = /^ALTER TABLE\s+(\w+)\s+RENAME TO\s+(\w+)\s*$/i;
const INSERT_FROM = /^INSERT(?:\s+OR\s+IGNORE)?\s+INTO\s+\w+[\s\S]*\bFROM\s+(\w+)/i;

/**
 * Apply one frozen SQL string, skipping work that would fail on a desynced
 * user_version (column already present, rename already done, source gone).
 */
export function applyMigrationStatement(db: SqlExecutor, statement: string, allowUnguardedAlter = false): void {
  const add = statement.match(ADD_COLUMN);
  if (add && !allowUnguardedAlter) {
    const table = add[1];
    const column = add[2];
    if (table && column && columnExists(db, table, column)) return;
  }

  const rename = statement.match(RENAME_TABLE);
  if (rename) {
    const from = rename[1];
    const to = rename[2];
    if (from && to) {
      if (!tableExists(db, from)) return;
      if (tableExists(db, to)) return;
    }
  }

  const insertFrom = statement.match(INSERT_FROM);
  if (insertFrom?.[1] && !tableExists(db, insertFrom[1])) return;

  db.executeSync(statement);
}

export async function runMigrations(
  db: SqlExecutor,
  options?: { allowUnguardedAlter?: boolean },
): Promise<void> {
  const versionResult = db.executeSync('PRAGMA user_version');
  const currentVersion: number = (versionResult.rows?.[0]?.user_version as number) ?? 0;

  if (currentVersion >= CURRENT_VERSION) {
    return;
  }

  const pending = MIGRATIONS.filter(m => m.version > currentVersion);

  for (const migration of pending) {
    db.executeSync('BEGIN');
    try {
      for (const statement of migration.statements) {
        applyMigrationStatement(db, statement, options?.allowUnguardedAlter === true);
      }
      db.executeSync(`PRAGMA user_version = ${migration.version}`);
      db.executeSync('COMMIT');
    } catch (err) {
      db.executeSync('ROLLBACK');
      throw new Error(`Migration v${migration.version} failed: ${(err as Error).message}`);
    }
  }
}

export { CURRENT_VERSION };
