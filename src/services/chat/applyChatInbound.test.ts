import { afterEach, describe, expect, it } from "vitest";
import { setDbForTests } from "../../db";
import { runMigrations } from "../../db/migrations";
import { openMemoryDb } from "../../db/__tests__/betterSqliteAdapter";
import { StorageService } from "../StorageService";
import { applyKnownChatKind, replayDeferredChatTags } from "./applyChatInbound";
import { buildChatReceiptEnvelope, buildChatTagEnvelope, dmScopeKey } from "../../types/chatKinds";
import { CHAT_DELETE_KIND, CHAT_MESSAGE_KIND, buildDmConversationId, type LinkMessage } from "../../types/link";
import { GROUP_MESSAGE_KIND } from "../../types/group";
import { LocalChatState } from "../localChatState";
import { PAYKIT_PAYMENT_REQUEST_KIND } from "../../types/payment";

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

  it("processes invalid inbound labels without storing a row", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.saveLinkMessage(dm());
    const rawJson = JSON.stringify({
      version: 1,
      kind: "chat.tag.v0",
      event_id: "11111111-1111-4111-8111-111111111111",
      sent_at: ts,
      target_event_id: uuid,
      target_author_pubky: OWNER,
      label: "final-tag",
      op: "add",
    });

    await expect(
      applyKnownChatKind({
        ownerPubky: OWNER,
        senderPubky: PEER,
        peerPubky: PEER,
        rawJson,
      }),
    ).resolves.toBe("processed");
    await expect(StorageService.listChatTagsForScope(OWNER, dmScopeKey(PEER))).resolves.toEqual([]);
  });

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

  it("bounds hostile deferred tags and replays one when its target arrives", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const targetEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    for (let index = 0; index < 1000; index += 1) {
      const eventId = `${String(index).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
      const envelope = buildChatTagEnvelope({
        eventId,
        sentAt: ts,
        targetEventId,
        targetAuthorPubky: OWNER,
        label: "ok",
        op: "add",
      });
      await expect(
        applyKnownChatKind({
          ownerPubky: OWNER,
          senderPubky: PEER,
          peerPubky: PEER,
          rawJson: envelope.json,
          receivedAt: ts,
        }),
      ).resolves.toBe("deferred");
    }
    expect(db.executeSync("SELECT COUNT(*) AS n FROM chat_pending_tags").rows?.[0]?.n).toBe(32);

    await StorageService.saveLinkMessage(dm({ eventId: targetEventId, senderPubky: OWNER }));
    await replayDeferredChatTags(OWNER, PEER);
    await expect(StorageService.listChatTagsForScope(OWNER, dmScopeKey(PEER))).resolves.toHaveLength(1);
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

  it("rejects group tags and receipts from a removed member", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const channelId = `${OWNER}:${uuid}`;
    const groupEvent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await StorageService.upsertGroupMember({
      ownerPubky: OWNER,
      channelId,
      memberPubky: PEER,
      role: "member",
      addedAt: ts,
      removedAt: ts,
      status: "removed",
    });
    await StorageService.saveGroupMessage({
      ownerPubky: OWNER,
      channelId,
      eventId: groupEvent,
      senderPubky: OWNER,
      kind: GROUP_MESSAGE_KIND,
      body: "hi",
      rawJson: "{}",
      sentAt: ts,
      receivedAt: ts,
      deliveryState: "sent",
      replyToEventId: null,
      replyToAuthorPubky: null,
      targetEventId: null,
      targetAuthorPubky: null,
      editedAt: null,
      deleted: false,
    });
    const tag = buildChatTagEnvelope({
      eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sentAt: ts,
      targetEventId: groupEvent,
      targetAuthorPubky: OWNER,
      label: "ok",
      op: "add",
      channelId,
    });
    expect(
      await applyKnownChatKind({
        ownerPubky: OWNER,
        senderPubky: PEER,
        peerPubky: PEER,
        rawJson: tag.json,
      }),
    ).toEqual({ error: "not-member" });
    expect(await StorageService.listChatTagsForScope(OWNER, channelId)).toHaveLength(0);
    const receipt = buildChatReceiptEnvelope({
      eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      sentAt: ts,
      status: "read",
      eventIds: [groupEvent],
      channelId,
    });
    expect(
      await applyKnownChatKind({
        ownerPubky: OWNER,
        senderPubky: PEER,
        peerPubky: PEER,
        rawJson: receipt.json,
      }),
    ).toEqual({ error: "not-member" });
    const row = await StorageService.findGroupMessageByEventId(OWNER, channelId, groupEvent);
    expect(row?.deliveryState).toBe("sent");
  });

  it("rejects cross-thread DM tag and receipt targets", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const other = "q".repeat(52);
    await StorageService.saveLinkMessage(
      dm({ conversationId: buildDmConversationId(other), peerPubky: other }),
    );
    const tag = buildChatTagEnvelope({
      eventId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      sentAt: ts,
      targetEventId: uuid,
      targetAuthorPubky: OWNER,
      label: "ok",
      op: "add",
    });
    expect(
      await applyKnownChatKind({
        ownerPubky: OWNER,
        senderPubky: PEER,
        peerPubky: PEER,
        rawJson: tag.json,
      }),
    ).toBe("deferred");
    const receipt = buildChatReceiptEnvelope({
      eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
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
    expect(applied).toEqual({ error: "wrong-author" });
    const row = await StorageService.findLinkMessageByEventId(OWNER, uuid);
    expect(row?.deliveryState).toBe("sent");
  });

  it("tombstones a DM unsend and drops FTS plus backup export", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.saveLinkMessage(dm({ body: "secret unsend token", rawJson: JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: uuid,
      sent_at: ts,
      body: "secret unsend token",
    }), senderPubky: PEER, direction: "received" }));
    expect((await LocalChatState.searchMessages(OWNER, "unsend")).length).toBe(1);
    const del = JSON.stringify({
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      sent_at: ts,
      target_event_id: uuid,
    });
    expect(
      await applyKnownChatKind({
        ownerPubky: OWNER,
        senderPubky: PEER,
        peerPubky: PEER,
        rawJson: del,
      }),
    ).toBe("applied");
    const row = await StorageService.findLinkMessageInConversation(
      OWNER,
      buildDmConversationId(PEER),
      uuid,
    );
    expect(row?.body).toBe("");
    expect(row?.rawJson).toContain('"deleted":true');
    expect(row?.rawJson).not.toContain("secret");
    expect((await LocalChatState.searchMessages(OWNER, "unsend")).length).toBe(0);
    const snap = await StorageService.collectOwnerBackup(OWNER);
    expect(snap.linkMessages.some((m) => m.eventId === uuid)).toBe(false);
  });

  it("defers an inbound delete until its target arrives", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const del = JSON.stringify({
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: "11111111-1111-4111-8111-111111111111",
      sent_at: ts,
      target_event_id: uuid,
    });

    expect(
      await applyKnownChatKind({
        ownerPubky: OWNER,
        senderPubky: PEER,
        peerPubky: PEER,
        rawJson: del,
      }),
    ).toBe("deferred");

    await StorageService.saveLinkMessage(
      dm({
        senderPubky: PEER,
        direction: "received",
        body: "arrived after delete",
      }),
    );
    expect(
      await applyKnownChatKind({
        ownerPubky: OWNER,
        senderPubky: PEER,
        peerPubky: PEER,
        rawJson: del,
      }),
    ).toBe("applied");
    expect(
      (await StorageService.findLinkMessageInConversation(OWNER, buildDmConversationId(PEER), uuid))
        ?.rawJson,
    ).toContain('"deleted":true');
  });

  it("rejects an inbound delete from a non-authorized sender", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.saveLinkMessage(dm({ senderPubky: OWNER }));
    const del = JSON.stringify({
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: "22222222-2222-4222-8222-222222222222",
      sent_at: ts,
      target_event_id: uuid,
    });

    expect(
      await applyKnownChatKind({
        ownerPubky: OWNER,
        senderPubky: PEER,
        peerPubky: PEER,
        rawJson: del,
      }),
    ).toEqual({ error: "wrong-author" });
  });

  it("rejects an inbound delete targeting a payment message", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.saveLinkMessage(
      dm({
        senderPubky: PEER,
        direction: "received",
        kind: PAYKIT_PAYMENT_REQUEST_KIND,
      }),
    );
    const del = JSON.stringify({
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: "33333333-3333-4333-8333-333333333333",
      sent_at: ts,
      target_event_id: uuid,
    });

    expect(
      await applyKnownChatKind({
        ownerPubky: OWNER,
        senderPubky: PEER,
        peerPubky: PEER,
        rawJson: del,
      }),
    ).toEqual({ error: "not-deletable" });
    expect(
      (await StorageService.findLinkMessageInConversation(OWNER, buildDmConversationId(PEER), uuid))
        ?.deleted,
    ).toBe(false);
  });

  it("does not upgrade an unsent row when a late receipt arrives", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.saveLinkMessage(dm({ deliveryState: "sending" }));
    await StorageService.tombstoneLinkMessage({
      ownerPubky: OWNER,
      peerPubky: PEER,
      conversationId: buildDmConversationId(PEER),
      eventId: uuid,
      senderPubky: OWNER,
    });
    const receipt = buildChatReceiptEnvelope({
      eventId: "44444444-4444-4444-8444-444444444444",
      sentAt: ts,
      status: "read",
      eventIds: [uuid],
    });

    await applyKnownChatKind({
      ownerPubky: OWNER,
      senderPubky: PEER,
      peerPubky: PEER,
      rawJson: receipt.json,
    });

    expect(
      await StorageService.findLinkMessageInConversation(
        OWNER,
        buildDmConversationId(PEER),
        uuid,
      ),
    ).toEqual(expect.objectContaining({ deleted: true, deliveryState: "unsent" }));
  });
});
