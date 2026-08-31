// Copied from BitcoinErrorLog/hypercolor src/db/sql.ts
// pin a0937be84efffe2a1be08aef3cbe2f541588a4ca
/**
 * Minimal SQLite executor surface shared by op-sqlite (production) and the
 * better-sqlite3 test adapter. StorageService and the migration runner only
 * need executeSync.
 */

export type SqlValue = string | number | null;
export type SqlParams = readonly SqlValue[];

export interface SqlExecuteResult {
  rows?: Record<string, unknown>[];
}

export interface SqlExecutor {
  executeSync(query: string, params?: readonly unknown[] | unknown[]): SqlExecuteResult;
}
