import { describe, expect, it } from "vitest";
import type { GroupChannel } from "@/types/group";
import type { LinkConversationSummary } from "@/types/link";
import {
  groupConversationId,
  mergeInboxRows,
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
    expect(messagePreview("paykit.payment_request", "ignored")).toBe("Payment");
    expect(messagePreview("chat.group.membership.v0", "create")).toBe("Group created");
    expect(messagePreview("chat.message.v0", "  hi  ")).toBe("hi");
  });

  it("round-trips a local group conversation id", () => {
    const id = "founderpubkyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(parseGroupConversationId(groupConversationId(id))).toBe(id);
    expect(parseGroupConversationId("dm:x")).toBeNull();
  });

  it("orders unread rows ahead of older read rows", () => {
    const rows = mergeInboxRows({
      dms: [
        dm({ conversationId: "dm:old", lastMessageAt: 500, unreadCount: 0, lastMessage: "old" }),
        dm({ conversationId: "dm:new-unread", lastMessageAt: 200, unreadCount: 2, lastMessage: "ping" }),
      ],
      groups: [
        {
          channel: channel({
            channelId: `${OWNER}:11111111-1111-1111-1111-111111111111`,
            name: "Crew",
            lastMessageAt: 400,
          }),
          preview: "later",
          unreadCount: 0,
        },
      ],
    });
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
});
