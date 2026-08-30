"use client";

import { useCallback, useEffect, useState } from "react";
import { groupConversationId } from "@/lib/inbox";
import { isMessagingEnabled } from "@/lib/session-ui";
import { sendAttachmentFromBytes } from "@/services/attachments/sendAttachment";
import { GroupService, subscribeGroupEvents } from "@/services/group/GroupService";
import { LinkService } from "@/services/link/LinkService";
import { StorageService } from "@/services/StorageService";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import type { AttachmentRecord } from "@/types/attachment";
import type { Contact } from "@/types";
import type { GroupChannel, GroupMember, GroupMessage } from "@/types/group";
import { isGroupTimelineVisible } from "@/types/group";
import { parsePubky } from "@/utils/pubkyId";

export function useChannel(channelId: string | null) {
  const localPubky = useAuthStore((s) => s.pubky);
  const status = useSessionStatusStore((s) => s.status);
  const [channel, setChannel] = useState<GroupChannel | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [establishedPeers, setEstablishedPeers] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(Boolean(channelId));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!channelId || !localPubky) {
      setChannel(null);
      setMessages([]);
      setMembers([]);
      setAttachments([]);
      setLoading(false);
      return;
    }
    const [ch, msgs, mems, atts, people, links] = await Promise.all([
      GroupService.getChannel(channelId),
      GroupService.listMessages(channelId),
      GroupService.listMembers(channelId),
      StorageService.listAttachmentsForChannel(localPubky, channelId),
      StorageService.getAllContacts(localPubky),
      StorageService.getAllLinks(localPubky),
    ]);
    setChannel(ch);
    setMessages(msgs.filter(isGroupTimelineVisible));
    setMembers(mems);
    setAttachments(atts);
    setContacts(people);
    setEstablishedPeers(
      links.filter((link) => link.status === "established").map((link) => link.peerPubky),
    );
    setLoading(false);
    const latest = msgs.reduce((max, message) => Math.max(max, message.sentAt), 0);
    await LinkService.markRead(groupConversationId(channelId), latest > 0 ? latest : Date.now());
  }, [channelId, localPubky]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!localPubky || !channelId) return;
    return subscribeGroupEvents((owner, id) => {
      if (owner === localPubky && id === channelId) void reload();
    });
  }, [localPubky, channelId, reload]);

  const isAdmin = members.some(
    (member) =>
      member.memberPubky === localPubky && member.status === "active" && member.role === "admin",
  );
  const selfActive = members.some(
    (member) => member.memberPubky === localPubky && member.status === "active",
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !channelId) return;
    setDraft("");
    const editId = editingEventId;
    setEditingEventId(null);
    setSending(true);
    setError(null);
    try {
      if (editId) await GroupService.editMessage(channelId, editId, text);
      else await GroupService.sendGroupMessage(channelId, text);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
      setDraft(text);
    } finally {
      setSending(false);
    }
  }, [draft, sending, channelId, editingEventId, reload]);

  const sendAttachment = useCallback(
    async (file: File) => {
      if (!channelId || sending) return;
      setSending(true);
      setError(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await sendAttachmentFromBytes(
          { type: "channel", channelId },
          bytes,
          file.type || "application/octet-stream",
        );
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Attachment failed");
      } finally {
        setSending(false);
      }
    },
    [channelId, sending, reload],
  );

  const react = useCallback(
    async (eventId: string, authorPubky: string, emoji: string) => {
      if (!channelId) return;
      setError(null);
      try {
        await GroupService.reactToMessage(channelId, eventId, emoji, authorPubky);
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Reaction failed");
      }
    },
    [channelId, reload],
  );

  const removeMember = useCallback(
    async (memberPubky: string) => {
      if (!channelId) return;
      setError(null);
      try {
        await GroupService.removeMember(channelId, memberPubky);
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Remove failed");
      }
    },
    [channelId, reload],
  );

  const addMember = useCallback(
    async (raw: string) => {
      if (!channelId) return;
      const parsed = parsePubky(raw);
      if (!parsed) {
        setError("Member must be a 52-character z-base-32 pubky with an established link.");
        return;
      }
      setError(null);
      try {
        await GroupService.addMember(channelId, parsed);
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Add failed");
      }
    },
    [channelId, reload],
  );

  const leave = useCallback(async () => {
    if (!channelId) return;
    setError(null);
    try {
      await GroupService.leaveChannel(channelId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Leave failed");
    }
  }, [channelId, reload]);

  const deleteMessage = useCallback(
    async (eventId: string) => {
      if (!channelId) return;
      setError(null);
      try {
        await GroupService.deleteMessage(channelId, eventId);
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    },
    [channelId, reload],
  );

  const retryFailed = useCallback(async () => {
    setError(null);
    try {
      await LinkService.retryPendingSends();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    }
  }, [reload]);

  return {
    localPubky,
    status,
    channel,
    messages,
    attachments,
    members,
    contacts,
    establishedPeers,
    draft,
    setDraft,
    editingEventId,
    setEditingEventId,
    sending,
    loading,
    error,
    isAdmin,
    selfActive,
    messagingEnabled: isMessagingEnabled(status),
    send,
    sendAttachment,
    react,
    removeMember,
    addMember,
    leave,
    deleteMessage,
    retryFailed,
    reload,
  };
}
