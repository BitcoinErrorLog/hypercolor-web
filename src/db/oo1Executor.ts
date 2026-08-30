import type { BindingSpec, Database } from "@sqlite.org/sqlite-wasm";
import type { SqlExecutor } from "./sql";

export type ClosableSqlExecutor = SqlExecutor & {
  close: () => void;
};

/**
 * Maps official sqlite3 oo1.DB onto the mobile `SqlExecutor.executeSync` seam.
 */
export function wrapOo1Db(
  db: Database,
  onClose?: () => void,
): ClosableSqlExecutor {
  return {
    executeSync(query, params) {
      const sql = query.trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
        db.exec(sql);
        return { rows: [] };
      }
      const bind =
        params && params.length > 0
          ? (params as unknown as BindingSpec)
          : undefined;
      const rows = db.exec({
        sql: query,
        bind,
        rowMode: "object",
        returnValue: "resultRows",
      });
      return { rows: rows as Record<string, unknown>[] };
    },
    close() {
      db.close();
      onClose?.();
    },
  };
}
