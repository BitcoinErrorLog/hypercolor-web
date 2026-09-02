import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInboxStore } from "./inboxStore";

const listLinkConversations = vi.fn();
const countPendingMessageRequests = vi.fn();
const listGroupChannels = vi.fn();

vi.mock("@/services/StorageService", () => ({
  StorageService: {
    listLinkConversations: (...args: unknown[]) => listLinkConversations(...args),
    countPendingMessageRequests: (...args: unknown[]) =>
      countPendingMessageRequests(...args),
    listGroupChannels: (...args: unknown[]) => listGroupChannels(...args),
  },
}));

describe("inboxStore", () => {
  beforeEach(() => {
    useInboxStore.getState().reset();
    listLinkConversations.mockReset();
    countPendingMessageRequests.mockReset();
    listGroupChannels.mockReset();
  });

  it("stores merged rows and pending request count", () => {
    useInboxStore.getState().setRows(
      [
        {
          id: "dm:x",
          kind: "dm",
          title: "x",
          preview: "hi",
          lastMessageAt: 1,
          unreadCount: 1,
          href: "/chats/dm:x",
        },
      ],
      3,
    );
    expect(useInboxStore.getState().rows).toHaveLength(1);
    expect(useInboxStore.getState().pendingRequests).toBe(3);
    expect(useInboxStore.getState().error).toBeNull();
  });

  it("reset clears inbox state", () => {
    useInboxStore.getState().setRows([], 2);
    useInboxStore.getState().setError("fail");
    useInboxStore.getState().reset();
    expect(useInboxStore.getState()).toMatchObject({
      rows: [],
      pendingRequests: 0,
      error: null,
      loading: false,
    });
  });

  it("loadInboxRows returns DMs only and never lists group channels", async () => {
    listLinkConversations.mockResolvedValue([
      {
        conversationId: "dm:peer",
        participantPubky: "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
        lastMessage: "hello",
        lastMessageAt: 10,
        lastKind: "chat.message.v0",
        unreadCount: 0,
      },
    ]);
    countPendingMessageRequests.mockResolvedValue(4);
    const { loadInboxRows } = await import("./inboxStore");
    const snapshot = await loadInboxRows("owner");
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]?.kind).toBe("dm");
    expect(snapshot.pendingRequests).toBe(4);
    expect(listGroupChannels).not.toHaveBeenCalled();
  });
});
