import { describe, expect, it } from "vitest";
import type { GroupChannel } from "@/types/group";
import type { LinkConversationSummary } from "@/types/link";
import {
  dmInboxRows,
  channelListRows,
  groupConversationId,
  inboxRowFromDm,
  inboxRowFromGroup,
  messagePreview,
  parseGroupConversationId,
  sortInboxRows,
} from "./inbox";

const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

function dm(
  partial: Partial<LinkConversationSummary> & Pick<LinkConversationSummary, "conversationId">,
): LinkConversationSummary {
  return {
    participantPubky: PEER,
    lastMessage: "hello",
    lastMessageAt: 100,
    lastKind: "chat.message.v0",
    lastDeliveryState: null,
    linkStatus: "established",
    unreadCount: 0,
    ...partial,
  };
}

function channel(partial: Partial<GroupChannel> & Pick<GroupChannel, "channelId" | "name">): GroupChannel {
  return {
    ownerPubky: OWNER,
    createdAt: 1,
    updatedAt: 1,
    createdBy: OWNER,
    isPublic: false,
    lastMessageAt: 50,
    membershipEpoch: 0,
    ...partial,
  };
}

describe("inbox", () => {
  it("previews attachment, payment, and membership kinds", () => {
    expect(messagePreview("chat.attachment.v0", "ignored")).toBe("Attachment");
    expect(messagePreview("paykit.payment_request", "ignored")).toBe("Payment request");
    expect(messagePreview("chat.group.membership.v0", "create")).toBe("Group created");
    expect(messagePreview("chat.message.v0", "  hi  ")).toBe("hi");
  });

  it("round-trips a local group conversation id", () => {
    const id = "founderpubkyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(parseGroupConversationId(groupConversationId(id))).toBe(id);
    expect(parseGroupConversationId("dm:x")).toBeNull();
  });

  it("orders unread rows ahead of older read rows", () => {
    const rows = sortInboxRows([
      inboxRowFromDm(dm({ conversationId: "dm:old", lastMessageAt: 500, unreadCount: 0, lastMessage: "old" })),
      inboxRowFromDm(
        dm({ conversationId: "dm:new-unread", lastMessageAt: 200, unreadCount: 2, lastMessage: "ping" }),
      ),
      inboxRowFromGroup({
        channel: channel({
          channelId: `${OWNER}:11111111-1111-1111-1111-111111111111`,
          name: "Crew",
          lastMessageAt: 400,
        }),
        preview: "later",
        unreadCount: 0,
      }),
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      "dm:new-unread",
      "dm:old",
      `${OWNER}:11111111-1111-1111-1111-111111111111`,
    ]);
    expect(rows[0]?.kind).toBe("dm");
    expect(rows[0]?.unreadCount).toBe(2);
    expect(rows[2]?.kind).toBe("group");
  });

  it("keeps sortInboxRows stable for equal unread and time", () => {
    const a = {
      id: "a",
      kind: "dm" as const,
      title: "a",
      preview: "a",
      lastMessageAt: 10,
      unreadCount: 0,
      href: "/chats/a",
    };
    const b = { ...a, id: "b", href: "/chats/b" };
    expect(sortInboxRows([a, b]).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("builds DM-only inbox rows and maps payment lastKind to a notice preview", () => {
    const rows = dmInboxRows([
      dm({
        conversationId: "dm:pay",
        lastKind: "paykit.payment_request",
        lastMessage: "Payment",
      }),
      dm({ conversationId: "dm:text", lastMessage: "hello" }),
    ]);
    expect(rows.every((row) => row.kind === "dm")).toBe(true);
    expect(rows.find((row) => row.id === "dm:pay")?.preview).toBe("Payment request");
    expect(rows.find((row) => row.id === "dm:text")?.preview).toBe("hello");
  });

  it("builds channel list rows from private groups", () => {
    const rows = channelListRows([
      {
        channel: channel({
          channelId: `${OWNER}:11111111-1111-1111-1111-111111111111`,
          name: "Crew",
        }),
        preview: "hi crew",
        unreadCount: 0,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("group");
    expect(rows[0]?.title).toBe("Crew");
    expect(rows[0]?.href).toContain("/channels/");
  });
});
