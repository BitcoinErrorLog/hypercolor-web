import type { InboxRow } from "@/lib/inbox";

export type InboxSnapshot = {
  rows: InboxRow[];
  pendingRequests: number;
};

export type InboxRefreshDeps = {
  /** Pull remote messages into local storage. */
  syncInbox: () => Promise<unknown>;
  /** Whether a sync is possible right now (messaging enabled and a live session). */
  canSync: () => boolean;
  /** Read the conversation list out of local storage. */
  loadRows: () => Promise<InboxSnapshot>;
  onRows: (snapshot: InboxSnapshot) => void;
  onError: (error: unknown) => void;
  onLoading: (loading: boolean) => void;
};

export type InboxRefresher = {
  /** Sync from the network, then read local storage. For load and status changes. */
  refresh: () => Promise<void>;
  /** Read local storage only. For reacting to "the inbox was synced". */
  reload: () => Promise<void>;
};

/**
 * Splits "sync then read" from "read".
 *
 * `syncInbox()` finishes by announcing that it synced. Reacting to that
 * announcement by syncing again re-enters `syncInbox` without bound, and each
 * pass does local storage work, so the main thread never yields long enough for
 * React to commit a transition into /chats. Anything listening for a sync must
 * therefore call `reload`, never `refresh`.
 */
export function createInboxRefresher(deps: InboxRefreshDeps): InboxRefresher {
  async function reload(): Promise<void> {
    try {
      deps.onRows(await deps.loadRows());
    } catch (error) {
      deps.onError(error);
    } finally {
      deps.onLoading(false);
    }
  }

  async function refresh(): Promise<void> {
    deps.onLoading(true);
    if (deps.canSync()) {
      try {
        await deps.syncInbox();
      } catch {
        // Local list still refreshes.
      }
    }
    await reload();
  }

  return { refresh, reload };
}
