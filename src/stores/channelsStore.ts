import { create } from "zustand";
import { excludeHeldFounderChannels, heldGroupFounderSet } from "@/lib/group-invites";
import {
  channelListRows,
  groupConversationId,
  messagePreview,
  type InboxRow,
} from "@/lib/inbox";
import { StorageService } from "@/services/StorageService";
import { isGroupTimelineVisible } from "@/types/group";

interface ChannelsState {
  rows: InboxRow[];
  loading: boolean;
  error: string | null;
  setRows: (rows: InboxRow[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useChannelsStore = create<ChannelsState>((set) => ({
  rows: [],
  loading: false,
  error: null,
  setRows: (rows) => set({ rows, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () => set({ rows: [], loading: false, error: null }),
}));

export function totalChannelUnread(rows: InboxRow[]): number {
  return rows.reduce((sum, row) => sum + Math.max(0, row.unreadCount), 0);
}

export async function loadChannelRows(ownerPubky: string): Promise<InboxRow[]> {
  const [channels, requests] = await Promise.all([
    StorageService.listGroupChannels(ownerPubky),
    StorageService.listMessageRequests(ownerPubky),
  ]);
  const visibleChannels = excludeHeldFounderChannels(channels, heldGroupFounderSet(requests));

  const groups = await Promise.all(
    visibleChannels.map(async (channel) => {
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

  return channelListRows(groups);
}
