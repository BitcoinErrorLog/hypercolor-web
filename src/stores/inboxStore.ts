import { create } from "zustand";
import { groupConversationId, mergeInboxRows, messagePreview, type InboxRow } from "@/lib/inbox";
import { StorageService } from "@/services/StorageService";
import { isGroupTimelineVisible } from "@/types/group";

interface InboxState {
  rows: InboxRow[];
  pendingRequests: number;
  loading: boolean;
  error: string | null;
  setRows: (rows: InboxRow[], pendingRequests: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  rows: [],
  pendingRequests: 0,
  loading: false,
  error: null,
  setRows: (rows, pendingRequests) => set({ rows, pendingRequests, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () => set({ rows: [], pendingRequests: 0, loading: false, error: null }),
}));

export async function loadInboxRows(ownerPubky: string): Promise<{
  rows: InboxRow[];
  pendingRequests: number;
}> {
  const [dms, channels, pendingRequests] = await Promise.all([
    StorageService.listLinkConversations(ownerPubky),
    StorageService.listGroupChannels(ownerPubky),
    StorageService.countPendingMessageRequests(ownerPubky),
  ]);

  const groups = await Promise.all(
    channels.map(async (channel) => {
      const [messages, cursor] = await Promise.all([
        StorageService.listGroupMessages(ownerPubky, channel.channelId, 20),
        StorageService.getLinkReadCursor(ownerPubky, groupConversationId(channel.channelId)),
      ]);
      const visible = messages.filter(isGroupTimelineVisible);
      const last = visible[visible.length - 1];
      const unreadCount = visible.filter(
        (message) =>
          message.senderPubky !== ownerPubky && message.sentAt > (cursor ?? 0),
      ).length;
      return {
        channel,
        preview: last
          ? last.deleted
            ? "Message deleted"
            : messagePreview(last.kind, last.body)
          : "No messages yet",
        unreadCount,
      };
    }),
  );

  return {
    rows: mergeInboxRows({ dms, groups }),
    pendingRequests,
  };
}
