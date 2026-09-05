"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseDmConversationId } from "@/types/link";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { loadInboxRows, useInboxStore } from "@/stores/inboxStore";
import { useThreadStore } from "@/stores/threadStore";
import { isMessagingEnabled } from "@/lib/session-ui";
import { createThreadInboxPoller, type ThreadInboxPoller } from "@/lib/thread-inbox-poll";
import { StorageService } from "@/services/StorageService";
import { LinkService } from "@/services/link/LinkService";
import { sendAttachmentFromBytes } from "@/services/attachments/sendAttachment";
import { emit } from "@/services/vibeware/collector";
import { emitCoarseError, sendOutcomeFromDelivery } from "@/services/vibeware/coarse";
import { useReceiverRoleStore } from "@/services/link/receiverRoleStore";
import { isStandbyNewChatBlocked } from "@/lib/delivery-status";

export function useThread(conversationId: string | null) {
  const localPubky = useAuthStore((s) => s.pubky);
  const status = useSessionStatusStore((s) => s.status);
  const parsed = conversationId ? parseDmConversationId(conversationId) : null;
  const participantPubky = parsed?.counterpartyPubky ?? null;
  const pollerRef = useRef<ThreadInboxPoller | null>(null);

  const storedConversationId = useThreadStore((s) => s.conversationId);
  const storedMessages = useThreadStore((s) => s.messages);
  const storedAttachments = useThreadStore((s) => s.attachments);
  const messages = storedConversationId === conversationId ? storedMessages : [];
  const attachments = storedConversationId === conversationId ? storedAttachments : [];

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [error, setError] = useState<string | null>(null);
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  const [linkSnapshot, setLinkSnapshot] = useState<string | null>(null);
  const [linkReady, setLinkReady] = useState(false);
  const receiverRole = useReceiverRoleStore((s) => s.role);

  const reload = useCallback(async () => {
    if (!localPubky || !conversationId || !participantPubky) {
      useThreadStore.getState().setSnapshot(conversationId, [], []);
      setLoading(false);
      return;
    }
    const [msgs, atts, link, serviceStatus] = await Promise.all([
      StorageService.getLinkMessagesForConversation(localPubky, conversationId, 200),
      StorageService.listAttachmentsForConversation(localPubky, conversationId),
      StorageService.getLink(localPubky, participantPubky),
      LinkService.getLinkStatus(participantPubky).catch(() => null),
    ]);
    setLinkStatus(serviceStatus ?? link?.status ?? null);
    setLinkSnapshot(link?.snapshot ?? null);
    setLinkReady(serviceStatus === "ready");
    useThreadStore.getState().setSnapshot(conversationId, msgs, atts);
    setLoading(false);
    const latest = msgs.reduce((max, message) => Math.max(max, message.sentAt), 0);
    await LinkService.markRead(conversationId, latest > 0 ? latest : Date.now());
    try {
      const snapshot = await loadInboxRows(localPubky);
      useInboxStore.getState().setRows(snapshot.rows, snapshot.pendingRequests);
    } catch {
      // Thread rows still render.
    }
  }, [conversationId, localPubky, participantPubky]);

  useEffect(() => {
    void (async () => {
      await reload();
    })();
  }, [reload]);

  useEffect(() => {
    if (!localPubky) return;
    return LinkService.subscribeInboxSynced((owner) => {
      if (owner === localPubky) void reload();
    });
  }, [localPubky, reload]);

  useEffect(() => {
    if (!participantPubky || !isMessagingEnabled(status) || !LinkService.hasSession()) {
      return;
    }
    const poller = createThreadInboxPoller({
      sync: async () => {
        await LinkService.syncInbox([participantPubky]);
      },
      isVisible: () =>
        typeof document !== "undefined" && document.visibilityState === "visible",
      documentRef: typeof document !== "undefined" ? document : undefined,
      windowRef: typeof window !== "undefined" ? window : undefined,
    });
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [participantPubky, status]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !participantPubky) return;
    if (isStandbyNewChatBlocked(receiverRole, linkStatus, { snapshot: linkSnapshot, linkReady })) return;
    setDraft("");
    setSending(true);
    setError(null);
    try {
      const sent = await LinkService.sendDm(participantPubky, text);
      const outcome = sendOutcomeFromDelivery(sent.deliveryState);
      if (outcome) {
        void emit("app.thread.send_settled", { channel: "dm", outcome, kind: "text" });
      }
      await pollerRef.current?.kick();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send this message.");
      setDraft(text);
      void emit("app.thread.send_settled", { channel: "dm", outcome: "failed", kind: "text" });
      emitCoarseError("thread", err);
    } finally {
      setSending(false);
    }
  }, [draft, sending, participantPubky, reload, receiverRole, linkStatus, linkSnapshot, linkReady]);

  const retryFailed = useCallback(async () => {
    setError(null);
    try {
      await LinkService.retryPendingSends();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
      emitCoarseError("thread", err);
    }
  }, [reload]);

  const sendAttachment = useCallback(
    async (file: File) => {
      if (!participantPubky || sending) return;
      if (isStandbyNewChatBlocked(receiverRole, linkStatus, { snapshot: linkSnapshot, linkReady })) return;
      setSending(true);
      setError(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const record = await sendAttachmentFromBytes(
          { type: "conversation", peerPubky: participantPubky },
          bytes,
          file.type || "application/octet-stream",
        );
        const outcome = sendOutcomeFromDelivery(record.deliveryState);
        if (outcome) {
          void emit("app.thread.send_settled", { channel: "dm", outcome, kind: "attachment" });
        }
        await pollerRef.current?.kick();
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Attachment failed.");
        void emit("app.thread.send_settled", {
          channel: "dm",
          outcome: "failed",
          kind: "attachment",
        });
        emitCoarseError("thread", err);
      } finally {
        setSending(false);
      }
    },
    [participantPubky, sending, reload, receiverRole, linkStatus, linkSnapshot, linkReady],
  );

  return {
    localPubky,
    participantPubky,
    conversationId,
    draft,
    setDraft,
    sending,
    loading,
    error,
    messages,
    attachments,
    status,
    send,
    retryFailed,
    sendAttachment,
    reload,
    receiverRole,
    linkStatus,
    linkSnapshot,
    linkReady,
  };
}
