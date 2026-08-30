import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInboxStore } from "./inboxStore";

describe("inboxStore", () => {
  beforeEach(() => {
    useInboxStore.getState().reset();
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
});

vi.mock("@/services/StorageService", () => ({
  StorageService: {},
}));
