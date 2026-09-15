"use client";

import { useCallback, useEffect, useMemo } from "react";
import { loadInboxRows, useInboxStore } from "@/stores/inboxStore";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { isMessagingEnabled } from "@/lib/session-ui";
import { createInboxRefresher } from "@/lib/inbox-refresh";
import { LinkService } from "@/services/link/LinkService";
import { emitCoarseError } from "@/services/vibeware/coarse";
import { isReadOnlyTabError } from "@/db/errors";

export function useInbox() {
  const ownerPubky = useAuthStore((s) => s.pubky);
  const status = useSessionStatusStore((s) => s.status);
  const rows = useInboxStore((s) => s.rows);
  const pendingRequests = useInboxStore((s) => s.pendingRequests);
  const loading = useInboxStore((s) => s.loading);
  const error = useInboxStore((s) => s.error);

  const refresher = useMemo(() => {
    if (!ownerPubky) return null;
    return createInboxRefresher({
      canSync: () => isMessagingEnabled(status) && LinkService.hasSession(),
      syncInbox: () => LinkService.syncInbox(),
      loadRows: () => loadInboxRows(ownerPubky),
      onRows: (snapshot) =>
        useInboxStore.getState().setRows(snapshot.rows, snapshot.pendingRequests),
      onError: (err) => {
        if (isReadOnlyTabError(err)) {
          useInboxStore.getState().setError(null);
          return;
        }
        useInboxStore
          .getState()
          .setError(err instanceof Error ? err.message : "Could not load conversations");
        emitCoarseError("chats", err);
      },
      onLoading: (value) => useInboxStore.getState().setLoading(value),
    });
  }, [ownerPubky, status]);

  const refresh = useCallback(async () => {
    if (!refresher) {
      useInboxStore.getState().reset();
      return;
    }
    await refresher.refresh();
  }, [refresher]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!ownerPubky || !refresher) return;
    const reload = () => {
      void refresher.reload();
    };
    const stopInbox = LinkService.subscribeInboxSynced((owner) => {
      if (owner === ownerPubky) reload();
    });
    return () => {
      stopInbox();
    };
  }, [ownerPubky, refresher]);

  return { ownerPubky, rows, pendingRequests, loading, error, refresh, status };
}
