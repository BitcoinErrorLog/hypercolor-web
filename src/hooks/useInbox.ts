"use client";

import { useCallback, useEffect } from "react";
import { loadInboxRows, useInboxStore } from "@/stores/inboxStore";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { isMessagingEnabled } from "@/lib/session-ui";
import { LinkService } from "@/services/link/LinkService";
import { subscribeGroupEvents } from "@/services/group/GroupService";
import { emitCoarseError } from "@/services/vibeware/coarse";

export function useInbox() {
  const ownerPubky = useAuthStore((s) => s.pubky);
  const status = useSessionStatusStore((s) => s.status);
  const rows = useInboxStore((s) => s.rows);
  const pendingRequests = useInboxStore((s) => s.pendingRequests);
  const loading = useInboxStore((s) => s.loading);
  const error = useInboxStore((s) => s.error);

  const refresh = useCallback(async () => {
    if (!ownerPubky) {
      useInboxStore.getState().reset();
      return;
    }
    useInboxStore.getState().setLoading(true);
    if (isMessagingEnabled(status) && LinkService.hasSession()) {
      try {
        await LinkService.syncInbox();
      } catch {
        // Local list still refreshes.
      }
    }
    try {
      const next = await loadInboxRows(ownerPubky);
      useInboxStore.getState().setRows(next.rows, next.pendingRequests);
    } catch (err) {
      useInboxStore
        .getState()
        .setError(err instanceof Error ? err.message : "Could not load conversations");
      emitCoarseError("chats", err);
    } finally {
      useInboxStore.getState().setLoading(false);
    }
  }, [ownerPubky, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!ownerPubky) return;
    const stopInbox = LinkService.subscribeInboxSynced((owner) => {
      if (owner === ownerPubky) void refresh();
    });
    const stopGroups = subscribeGroupEvents((owner) => {
      if (owner === ownerPubky) void refresh();
    });
    return () => {
      stopInbox();
      stopGroups();
    };
  }, [ownerPubky, refresh]);

  return { ownerPubky, rows, pendingRequests, loading, error, refresh, status };
}
