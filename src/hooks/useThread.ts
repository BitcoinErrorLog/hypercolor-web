"use client";

import { useCallback, useEffect, useState } from "react";
import { parseDmConversationId } from "@/types/link";
import type { AttachmentRecord } from "@/types/attachment";
import type { LinkMessage } from "@/types/link";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { isMessagingEnabled } from "@/lib/session-ui";
import { StorageService } from "@/services/StorageService";
import { LinkService } from "@/services/link/LinkService";
import { sendAttachmentFromBytes } from "@/services/attachments/sendAttachment";

export function useThread(conversationId: string | null) {
  const localPubky = useAuthStore((s) => s.pubky);
  const status = useSessionStatusStore((s) => s.status);
  const parsed = conversationId ? parseDmConversationId(conversationId) : null;
  const participantPubky = parsed?.counterpartyPubky ?? null;

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<LinkMessage[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);

  const reload = useCallback(async () => {
    if (!localPubky || !conversationId || !participantPubky) {
      setMessages([]);
      setAttachments([]);
      setLoading(false);
      return;
    }
    const [msgs, atts] = await Promise.all([
      StorageService.getLinkMessagesForConversation(localPubky, conversationId, 200),
      StorageService.listAttachmentsForConversation(localPubky, conversationId),
    ]);
    setMessages(msgs);
    setAttachments(atts);
    setLoading(false);
    const latest = msgs.reduce((max, message) => Math.max(max, message.sentAt), 0);
    await LinkService.markRead(conversationId, latest > 0 ? latest : Date.now());
  }, [conversationId, localPubky, participantPubky]);

  useEffect(() => {
    void (async () => {
      if (isMessagingEnabled(status) && LinkService.hasSession() && participantPubky) {
        try {
          await LinkService.syncInbox([participantPubky]);
        } catch {
          // Local history still renders.
        }
      }
      await reload();
    })();
  }, [participantPubky, reload, status]);

  useEffect(() => {
    if (!localPubky) return;
    return LinkService.subscribeInboxSynced((owner) => {
      if (owner === localPubky) void reload();
    });
  }, [localPubky, reload]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !participantPubky) return;
    setDraft("");
    setSending(true);
    setError(null);
    try {
      await LinkService.sendDm(participantPubky, text);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send this message.");
      setDraft(text);
    } finally {
      setSending(false);
    }
  }, [draft, sending, participantPubky, reload]);

  const retryFailed = useCallback(async () => {
    setError(null);
    try {
      await LinkService.retryPendingSends();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
    }
  }, [reload]);

  const sendAttachment = useCallback(
    async (file: File) => {
      if (!participantPubky || sending) return;
      setSending(true);
      setError(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await sendAttachmentFromBytes(
          { type: "conversation", peerPubky: participantPubky },
          bytes,
          file.type || "application/octet-stream",
        );
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Attachment failed.");
      } finally {
        setSending(false);
      }
    },
    [participantPubky, sending, reload],
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
  };
}
