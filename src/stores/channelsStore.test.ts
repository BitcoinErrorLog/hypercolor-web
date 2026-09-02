import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChannelsStore } from "./channelsStore";

const listGroupChannels = vi.fn();
const listMessageRequests = vi.fn();
const listGroupMessages = vi.fn();
const getLinkReadCursor = vi.fn();
const listLinkConversations = vi.fn();

vi.mock("@/services/StorageService", () => ({
  StorageService: {
    listGroupChannels: (...args: unknown[]) => listGroupChannels(...args),
    listMessageRequests: (...args: unknown[]) => listMessageRequests(...args),
    listGroupMessages: (...args: unknown[]) => listGroupMessages(...args),
    getLinkReadCursor: (...args: unknown[]) => getLinkReadCursor(...args),
    listLinkConversations: (...args: unknown[]) => listLinkConversations(...args),
  },
}));

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const CHANNEL_ID = `${OWNER}:11111111-1111-1111-1111-111111111111`;

describe("channelsStore", () => {
  beforeEach(() => {
    useChannelsStore.getState().reset();
    listGroupChannels.mockReset();
    listMessageRequests.mockReset();
    listGroupMessages.mockReset();
    getLinkReadCursor.mockReset();
    listLinkConversations.mockReset();
  });

  it("loadChannelRows maps private groups and does not read DM conversations", async () => {
    listGroupChannels.mockResolvedValue([
      {
        channelId: CHANNEL_ID,
        ownerPubky: OWNER,
        name: "Crew",
        createdAt: 1,
        updatedAt: 2,
        createdBy: OWNER,
        isPublic: false,
        lastMessageAt: 50,
        membershipEpoch: 0,
      },
    ]);
    listMessageRequests.mockResolvedValue([]);
    listGroupMessages.mockResolvedValue([
      {
        senderPubky: OWNER,
        kind: "chat.group.message.v0",
        body: "hi crew",
        sentAt: 50,
        deleted: false,
      },
    ]);
    getLinkReadCursor.mockResolvedValue(0);

    const { loadChannelRows } = await import("./channelsStore");
    const rows = await loadChannelRows(OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("group");
    expect(rows[0]?.title).toBe("Crew");
    expect(rows[0]?.preview).toBe("hi crew");
    expect(rows[0]?.unreadCount).toBe(0);
    expect(listLinkConversations).not.toHaveBeenCalled();
  });

  it("counts peer messages after the read cursor as unread and totals them", async () => {
    const peer = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
    listGroupChannels.mockResolvedValue([
      {
        channelId: CHANNEL_ID,
        ownerPubky: OWNER,
        name: "Crew",
        createdAt: 1,
        updatedAt: 2,
        createdBy: OWNER,
        isPublic: false,
        lastMessageAt: 80,
        membershipEpoch: 0,
      },
    ]);
    listMessageRequests.mockResolvedValue([]);
    listGroupMessages.mockResolvedValue([
      {
        senderPubky: peer,
        kind: "chat.group.message.v0",
        body: "hello",
        sentAt: 80,
        deleted: false,
      },
    ]);
    getLinkReadCursor.mockResolvedValue(10);

    const { loadChannelRows, totalChannelUnread } = await import("./channelsStore");
    const rows = await loadChannelRows(OWNER);
    expect(rows[0]?.unreadCount).toBe(1);
    expect(totalChannelUnread(rows)).toBe(1);
    expect(totalChannelUnread([])).toBe(0);
  });
});
