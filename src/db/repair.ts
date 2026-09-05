import { discardCloseDb, getDb } from "./index";
import { CURRENT_VERSION } from "./migrations";
import {
  bumpPersistGeneration,
  deleteSqliteSnapshot,
} from "./openWebSqlite";
import { SqliteRepairIncompleteError } from "./errors";
import { getTabLock, initTabLock, requestTakeoverAndWait } from "@/services/tabLock";
import type { SqlExecutor } from "./sql";

function tableNames(db: SqlExecutor): string[] {
  const result = db.executeSync(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  return (result.rows ?? []).map((row) => String(row.name));
}

function isFreshRepairedDb(db: SqlExecutor): boolean {
  const version = Number(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version ?? -1);
  if (version !== CURRENT_VERSION) return false;
  for (const name of tableNames(db)) {
    const count = Number(db.executeSync(`SELECT COUNT(*) AS n FROM ${name}`).rows?.[0]?.n ?? 1);
    if (count !== 0) return false;
  }
  return true;
}

async function wipeAndReopen(): Promise<SqlExecutor> {
  bumpPersistGeneration();
  discardCloseDb();
  await deleteSqliteSnapshot();
  return getDb();
}

/**
 * Wipe the local sqlite snapshot (IndexedDB + kvvfs) and reopen an empty
 * migrated database, then re-run the same receiver provision + inbox sync
 * the first Enable uses. KeyStore identity/session is not touched.
 *
 * Must run as the writer tab: takeover first. Discard-close (no persist)
 * before delete so a stale in-memory snapshot cannot recreate the blob.
 */
export async function repairLocalData(): Promise<void> {
  await initTabLock();
  if (getTabLock().mode !== "writer") {
    await requestTakeoverAndWait();
  }
  let db = await wipeAndReopen();
  if (!isFreshRepairedDb(db)) {
    db = await wipeAndReopen();
  }
  if (!isFreshRepairedDb(db)) {
    throw new SqliteRepairIncompleteError();
  }

  const { LinkService } = await import("@/services/link/LinkService");
  if (!LinkService.hasSession()) return;
  await LinkService.provisionReceiverForActiveSession();
  await LinkService.syncInbox();
}
