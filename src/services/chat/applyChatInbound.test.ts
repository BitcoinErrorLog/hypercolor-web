import { afterEach, describe, expect, it } from "vitest";
import { setDbForTests } from "../../db";
import { runMigrations } from "../../db/migrations";
import { openMemoryDb } from "../../db/__tests__/betterSqliteAdapter";
import { StorageService } from "../StorageService";
import { applyKnownChatKind } from "./applyChatInbound";
import { buildChatReceiptEnvelope, buildChatTagEnvelope, dmScopeKey } from "../../types/chatKinds";
import { CHAT_MESSAGE_KIND, buildDmConversationId, type LinkMessage } from "../../types/link";

const OWNER = "o".repeat(52);
const PEER = "p".repeat(52);
const uuid = "01234567-89ab-cdef-0123-456789abcdef";
const ts = 1_757_000_000_000;

function dm(partial: Partial<LinkMessage> = {}): LinkMessage {
  return {
    ownerPubky: OWNER,
    eventId: uuid,
    conversationId: buildDmConversationId(PEER),
    peerPubky: PEER,
    senderPubky: OWNER,
    direction: "sent",
    kind: CHAT_MESSAGE_KIND,
    rawJson: "{}",
    body: "hi",
    sentAt: ts,
    receivedAt: null,
    deliveryState: "sent",
    ...partial,
  };
}

describe("apply chat.tag.v0 / chat.receipt.v0", () => {
  afterEach(() => setDbForTests(null));

  it("stores tags, ignores replay, rejects spoofed tagger via sender", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.saveLinkMessage(dm());
    const built = buildChatTagEnvelope({
      eventId: "11111111-1111-4111-8111-111111111111",
      sentAt: ts,
      targetEventId: uuid,
      targetAuthorPubky: OWNER,
      label: "ok",
      op: "add",
    });
    const first = await applyKnownChatKind({
      ownerPubky: OWNER,
      senderPubky: PEER,
      peerPubky: PEER,
      rawJson: built.json,
    });
    expect(first).toBe("applied");
    const again = await applyKnownChatKind({
      ownerPubky: OWNER,
      senderPubky: PEER,
      peerPubky: PEER,
      rawJson: built.json,
    });
    expect(again).toBe("applied");
    const rows = await StorageService.listChatTagsForScope(OWNER, dmScopeKey(PEER));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.taggerPubky).toBe(PEER);
  });

  it("applies receipts monotonically and drops self ids", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.saveLinkMessage(dm({ deliveryState: "sent" }));
    const receipt = buildChatReceiptEnvelope({
      eventId: "22222222-2222-4222-8222-222222222222",
      sentAt: ts,
      status: "read",
      eventIds: [uuid],
    });
    const applied = await applyKnownChatKind({
      ownerPubky: OWNER,
      senderPubky: PEER,
      peerPubky: PEER,
      rawJson: receipt.json,
    });
    expect(applied).toBe("applied");
    const row = await StorageService.findLinkMessageByEventId(OWNER, uuid);
    expect(row?.deliveryState).toBe("read");
    const selfReceipt = buildChatReceiptEnvelope({
      eventId: "33333333-3333-4333-8333-333333333333",
      sentAt: ts,
      status: "delivered",
      eventIds: [uuid],
    });
    const self = await applyKnownChatKind({
      ownerPubky: OWNER,
      senderPubky: OWNER,
      peerPubky: PEER,
      rawJson: selfReceipt.json,
    });
    expect(self).toEqual({ error: "wrong-author" });
  });
});
