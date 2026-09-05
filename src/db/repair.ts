import { closeDb, getDb } from "./index";
import { deleteSqliteSnapshot } from "./openWebSqlite";
import { getTabLock, initTabLock, requestTakeoverAndWait } from "@/services/tabLock";

/**
 * Wipe the local sqlite snapshot (IndexedDB + kvvfs) and reopen an empty
 * migrated database, then re-run the same receiver provision + inbox sync
 * the first Enable uses. KeyStore identity/session is not touched.
 *
 * Must run as the writer tab: takeover first, then flush any in-flight
 * persist so we do not delete while another tab still holds unflushed rows.
 */
export async function repairLocalData(): Promise<void> {
  await initTabLock();
  if (getTabLock().mode !== "writer") {
    await requestTakeoverAndWait();
  }
  const live = (await getDb()) as { flushPersist?: () => Promise<void> };
  await live.flushPersist?.();
  closeDb();
  await deleteSqliteSnapshot();
  await getDb();

  const { LinkService } = await import("@/services/link/LinkService");
  if (!LinkService.hasSession()) return;
  await LinkService.provisionHarnessReceiver();
  await LinkService.syncInbox();
}
