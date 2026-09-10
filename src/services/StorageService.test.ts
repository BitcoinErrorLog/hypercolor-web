/**
 * StorageService against real v13 SQL (better-sqlite3) and real WebKeyStore
 * (fake-indexeddb). Mobile mocks KeyStore; web exercises the async methods.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setDbForTests } from "../db";
import { openMemoryDb } from "../db/__tests__/betterSqliteAdapter";
import { CURRENT_VERSION, runMigrations } from "../db/migrations";
import { CHAT_MESSAGE_KIND } from "../types/link";
import { GROUP_MESSAGE_KIND } from "../types/group";
import { KeyStore } from "./KeyStore";
import { StorageService } from "./StorageService";

const deleteCacheFilesMock = vi.hoisted(() => vi.fn());
vi.mock("./attachments/fileIo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./attachments/fileIo")>()),
  deleteCacheFiles: deleteCacheFilesMock,
}));

const OWNER = "a".repeat(52);
const PEER = "z".repeat(52);
const OTHER = "b".repeat(52);
const EVENT = "00000000-0000-4000-8000-000000000001";
const ATTACH_EVENT = "00000000-0000-4000-8000-0000000000a1";

const ATTACHMENT_SECRET = {
  key: "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE",
  nonce: "bm5ubm5ubm5ubm5ubm5ubm5ubm4",
  algorithm: "XChaCha20Poly1305",
};

describe("StorageService (v13 SQL + KeyStore)", () => {
  beforeAll(async () => {
    await KeyStore.initKeyStore();
  });

  beforeEach(async () => {
    await KeyStore.clear();
    deleteCacheFilesMock.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    setDbForTests(null);
  });

  it("migrates to v14, inserts and reads a contact and a link", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(
      CURRENT_VERSION,
    );

    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      displayName: "Zed",
      trustScore: 0.2,
      isFollowing: true,
      isFollower: true,
      isMutual: true,
      addedManually: true,
      firstSeenAt: 10,
    });
    expect(await StorageService.getContact(PEER, OWNER)).toEqual(
      expect.objectContaining({
        ownerPubky: OWNER,
        displayName: "Zed",
        isFollowing: true,
        addedManually: true,
      }),
    );

    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "initiator",
      status: "established",
      snapshot: "cipher-1",
      remoteNoisePublicKey: "noise",
      localReceiverPath: "hypercolor/wallet",
      remoteReceiverPath: "hypercolor/wallet",
      consecutiveFailures: 0,
    });
    expect(await StorageService.getLink(OWNER, PEER)).toEqual(
      expect.objectContaining({
        ownerPubky: OWNER,
        peerPubky: PEER,
        snapshot: "cipher-1",
        status: "established",
      }),
    );
  });

  it("recording last_seen_peer_marker_pk does not bump links.updated_at", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "initiator",
      status: "handshaking",
      snapshot: "cipher-hs",
      remoteNoisePublicKey: "noise",
      localReceiverPath: "hypercolor/wallet",
      remoteReceiverPath: "hypercolor/wallet",
      consecutiveFailures: 0,
    });
    const before = await StorageService.getLink(OWNER, PEER);
    expect(before).not.toBeNull();
    db.executeSync(
      "UPDATE links SET updated_at = 111 WHERE owner_pubky = ? AND peer_pubky = ?",
      [OWNER, PEER],
    );

    await StorageService.recordLastSeenPeerMarkerPk(OWNER, PEER, "marker-pk-2");

    const after = await StorageService.getLink(OWNER, PEER);
    expect(after?.lastSeenPeerMarkerPk).toBe("marker-pk-2");
    expect(after?.updatedAt).toBe(111);
    expect(after?.snapshot).toBe("cipher-hs");
  });

  it("clearAccountData wipes owner rows and leaves the other account", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0.2,
      isFollowing: true,
      isFollower: false,
      isMutual: false,
      addedManually: true,
      firstSeenAt: 10,
    });
    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OTHER,
      trustScore: 0.9,
      isFollowing: false,
      isFollower: true,
      isMutual: false,
      addedManually: false,
      firstSeenAt: 11,
    });
    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "initiator",
      status: "established",
      snapshot: "owner-cipher",
      remoteNoisePublicKey: "noise",
      localReceiverPath: "hypercolor/wallet",
      remoteReceiverPath: "hypercolor/wallet",
      consecutiveFailures: 0,
    });
    await StorageService.upsertLink({
      ownerPubky: OTHER,
      peerPubky: PEER,
      role: "responder",
      status: "established",
      snapshot: "other-cipher",
      remoteNoisePublicKey: "noise",
      localReceiverPath: "hypercolor/wallet",
      remoteReceiverPath: "hypercolor/wallet",
      consecutiveFailures: 0,
    });

    db.executeSync(
      `INSERT INTO contact_nicknames (owner_pubky, peer_pubky, nickname, updated_at)
       VALUES (?, ?, 'Star', 1)`,
      [OWNER, PEER],
    );
    db.executeSync(
      `INSERT INTO thread_local_state (owner_pubky, thread_key, muted, archived, updated_at)
       VALUES (?, 'dm:x', 1, 0, 1)`,
      [OWNER],
    );
    const { indexDecryptedMessage, ensureMessageSearchFts } = await import("./localChatState");
    ensureMessageSearchFts(db);
    indexDecryptedMessage(db, {
      ownerPubky: OWNER,
      threadKey: "dm:x",
      eventId: EVENT,
      senderPubky: PEER,
      body: "Secret hello world",
      sentAt: 1,
    });

    await StorageService.clearAccountData(OWNER);

    expect(db.executeSync("SELECT COUNT(*) AS n FROM contact_nicknames WHERE owner_pubky = ?", [OWNER]).rows?.[0]?.n).toBe(0);
    expect(db.executeSync("SELECT COUNT(*) AS n FROM thread_local_state WHERE owner_pubky = ?", [OWNER]).rows?.[0]?.n).toBe(0);
    expect(db.executeSync("SELECT COUNT(*) AS n FROM message_search WHERE owner_pubky = ?", [OWNER]).rows?.[0]?.n).toBe(0);
    expect(db.executeSync("SELECT COUNT(*) AS n FROM message_search_fts").rows?.[0]?.n).toBe(0);
    expect(
      db.executeSync(
        `SELECT COUNT(*) AS n FROM message_search_fts WHERE message_search_fts MATCH 'hello'`,
      ).rows?.[0]?.n,
    ).toBe(0);

    expect(await StorageService.getContact(PEER, OWNER)).toBeNull();
    expect(await StorageService.getLink(OWNER, PEER)).toBeNull();
    expect(await StorageService.getContact(PEER, OTHER)).toEqual(
      expect.objectContaining({ ownerPubky: OTHER, isFollower: true }),
    );
    expect((await StorageService.getLink(OTHER, PEER))?.snapshot).toBe(
      "other-cipher",
    );
  });

  it("clearAccountData deletes owner attachment secrets via async KeyStore", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    await KeyStore.setPubky(OWNER);
    await KeyStore.setAttachmentSecret(
      OWNER,
      PEER,
      ATTACH_EVENT,
      ATTACHMENT_SECRET,
    );
    expect(
      await KeyStore.getAttachmentSecret(OWNER, PEER, ATTACH_EVENT),
    ).toEqual(ATTACHMENT_SECRET);

    await StorageService.saveAttachment({
      ownerPubky: OWNER,
      eventId: ATTACH_EVENT,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: PEER,
      direction: "received",
      location: `/pub/hypercolor.app/v1/attachments/${ATTACH_EVENT}`,
      keyRef: KeyStore.attachmentKeyService(OWNER, PEER, ATTACH_EVENT),
      contentType: "image/png",
      size: 32,
      thumbnailLocation: null,
      localCachePath: null,
      createdAt: 1,
      updatedAt: 1,
      deliveryState: "delivered",
      resolveState: "ready",
    });
    expect(await StorageService.hasAttachment(OWNER, PEER, ATTACH_EVENT)).toBe(
      true,
    );

    await StorageService.clearAccountData(OWNER);

    expect(await StorageService.getAttachment(OWNER, PEER, ATTACH_EVENT)).toBeNull();
    expect(
      await KeyStore.getAttachmentSecret(OWNER, PEER, ATTACH_EVENT),
    ).toBeNull();
  });

  it("runs scoped dedup, send protocol, and sign-out wipe", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    await StorageService.upsertLinkReceiver({
      ownerPubky: OWNER,
      receiverAlias: "recv-1",
      receiverPath: "hypercolor/wallet",
      markerPublished: true,
    });

    await StorageService.saveLinkMessage({
      ownerPubky: OWNER,
      eventId: EVENT,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: PEER,
      direction: "received",
      kind: CHAT_MESSAGE_KIND,
      rawJson: "{}",
      body: "from peer",
      sentAt: 10,
      receivedAt: 11,
      deliveryState: "delivered",
    });
    await StorageService.saveLinkMessage({
      ownerPubky: OWNER,
      eventId: EVENT,
      conversationId: `dm:${OTHER}`,
      peerPubky: OTHER,
      senderPubky: OTHER,
      direction: "received",
      kind: CHAT_MESSAGE_KIND,
      rawJson: "{}",
      body: "from other",
      sentAt: 10,
      receivedAt: 11,
      deliveryState: "delivered",
    });
    await StorageService.saveLinkMessage({
      ownerPubky: OWNER,
      eventId: EVENT,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: PEER,
      direction: "received",
      kind: CHAT_MESSAGE_KIND,
      rawJson: "{}",
      body: "duplicate",
      sentAt: 12,
      receivedAt: 13,
      deliveryState: "delivered",
    });

    expect(
      await StorageService.hasLinkMessage(OWNER, PEER, CHAT_MESSAGE_KIND, EVENT),
    ).toBe(true);
    expect(
      await StorageService.hasLinkMessage(
        OWNER,
        OTHER,
        CHAT_MESSAGE_KIND,
        EVENT,
      ),
    ).toBe(true);
    const forPeer = await StorageService.getLinkMessagesForConversation(
      OWNER,
      `dm:${PEER}`,
    );
    expect(forPeer).toHaveLength(1);
    expect(forPeer[0]!.body).toBe("from peer");

    await StorageService.persistLinkSendIntent({
      message: {
        ownerPubky: OWNER,
        eventId: "00000000-0000-4000-8000-000000000002",
        conversationId: `dm:${PEER}`,
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: "sent",
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"exact":true}',
        body: "out",
        sentAt: 20,
        receivedAt: null,
        deliveryState: "sending",
      },
      queueItem: {
        id: "q-1",
        messageId: "00000000-0000-4000-8000-000000000002",
        recipientPubky: PEER,
        payload: '{"type":"link.chat.message","rawJson":"{\\"exact\\":true}"}',
        attempts: 0,
        nextRetryAt: 20,
        createdAt: 20,
      },
    });

    const queued = await StorageService.listDeliveryQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toContain("exact");

    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "initiator",
      status: "established",
      snapshot: "cipher-1",
      remoteNoisePublicKey: "noise",
      localReceiverPath: "hypercolor/wallet",
      remoteReceiverPath: "hypercolor/wallet",
      consecutiveFailures: 0,
    });

    await StorageService.finalizeLinkSend({
      ownerPubky: OWNER,
      peerPubky: PEER,
      senderPubky: OWNER,
      kind: CHAT_MESSAGE_KIND,
      eventId: "00000000-0000-4000-8000-000000000002",
      snapshot: "cipher-2",
      queueId: "q-1",
    });

    const sent = await StorageService.getLinkMessage(
      OWNER,
      OWNER,
      CHAT_MESSAGE_KIND,
      "00000000-0000-4000-8000-000000000002",
    );
    expect(sent?.deliveryState).toBe("sent");
    expect((await StorageService.getLink(OWNER, PEER))?.snapshot).toBe(
      "cipher-2",
    );
    expect(await StorageService.listDeliveryQueue()).toHaveLength(0);

    await StorageService.saveLinkStreamItems([
      {
        id: "st-1",
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: "other.v0",
        rawJson: '{"kind":"other.v0"}',
        receivedAt: 30,
      },
    ]);
    expect(
      await StorageService.getUnprocessedLinkStreamItems(OWNER, PEER),
    ).toHaveLength(1);

    expect(
      await StorageService.incrementLinkConsecutiveFailures(OWNER, PEER),
    ).toBe(1);

    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0,
      isFollowing: true,
      isFollower: false,
      isMutual: false,
      addedManually: false,
      firstSeenAt: 1,
    });
    await StorageService.upsertMessageRequest({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: 1,
      updatedAt: 1,
      status: "pending",
    });

    await StorageService.clearAccountData(OWNER);
    expect(await StorageService.getLinkReceiver(OWNER)).toBeNull();
    expect(await StorageService.getLink(OWNER, PEER)).toBeNull();
    expect(
      await StorageService.getLinkMessagesForConversation(OWNER, `dm:${PEER}`),
    ).toEqual([]);
    expect(
      await StorageService.getUnprocessedLinkStreamItems(OWNER, PEER),
    ).toEqual([]);
    expect(await StorageService.getContact(PEER, OWNER)).toBeNull();
    expect(await StorageService.getMessageRequest(OWNER, PEER)).toBeNull();
  });

  it("lists owed outbound DMs and looks up a queue item by id", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.persistLinkSendIntent({
      message: {
        ownerPubky: OWNER,
        eventId: EVENT,
        conversationId: `dm:${PEER}`,
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: "sent",
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"k":1}',
        body: "owed",
        sentAt: 40,
        receivedAt: null,
        deliveryState: "sending",
      },
      queueItem: {
        id: "q-owed",
        messageId: EVENT,
        recipientPubky: PEER,
        payload: JSON.stringify({ type: "link.chat.message", ownerPubky: OWNER }),
        attempts: 1,
        nextRetryAt: 40,
        createdAt: 40,
      },
    });
    const owed = await StorageService.listOwedOutboundLinkMessages(OWNER);
    expect(owed).toHaveLength(1);
    expect(owed[0]?.eventId).toBe(EVENT);
    expect(owed[0]?.sentAt).toBe(40);
    const queued = await StorageService.getDeliveryQueueItem("q-owed");
    expect(queued?.messageId).toBe(EVENT);
    await StorageService.removeQueueItemsForRecipient(PEER, OWNER);
    expect(await StorageService.getDeliveryQueueItem("q-owed")).toBeNull();
    expect(await StorageService.listOwedOutboundLinkMessages(OWNER)).toHaveLength(1);

    await StorageService.updateLinkMessageDeliveryState(
      OWNER,
      OWNER,
      CHAT_MESSAGE_KIND,
      EVENT,
      "failed",
    );
    expect(await StorageService.listOwedOutboundLinkMessages(OWNER)).toEqual([]);
  });

  it("abandons a peer's owed DM rows so the heal skips them (R4-F4)", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    const OTHER_EVENT = "00000000-0000-4000-8000-000000000002";
    const SENT_EVENT = "00000000-0000-4000-8000-000000000003";
    const dmRow = (eventId: string, peer: string, deliveryState: "sending" | "failed" | "sent") => ({
      ownerPubky: OWNER,
      eventId,
      conversationId: `dm:${peer}`,
      peerPubky: peer,
      senderPubky: OWNER,
      direction: "sent" as const,
      kind: CHAT_MESSAGE_KIND,
      rawJson: '{"k":1}',
      body: "x",
      sentAt: 40,
      receivedAt: null,
      deliveryState,
    });
    await StorageService.saveLinkMessage(dmRow(EVENT, PEER, "sending"));
    await StorageService.saveLinkMessage(dmRow(SENT_EVENT, PEER, "sent"));
    await StorageService.saveLinkMessage(dmRow(OTHER_EVENT, OTHER, "sending"));

    await StorageService.abandonOwedLinkMessagesForPeer(OWNER, PEER);

    // Heal only lists `sending`. The reset peer is now `failed`; the
    // other peer's in-flight row is still owed.
    const owed = await StorageService.listOwedOutboundLinkMessages(OWNER);
    expect(owed).toHaveLength(1);
    expect(owed[0]?.eventId).toBe(OTHER_EVENT);

    // The abandoned row is terminally failed; the sent row is untouched.
    const peerRows = await StorageService.getLinkMessagesForConversation(
      OWNER,
      `dm:${PEER}`,
    );
    const abandoned = peerRows.find((row) => row.eventId === EVENT);
    const sent = peerRows.find((row) => row.eventId === SENT_EVENT);
    expect(abandoned?.deliveryState).toBe("failed");
    expect(sent?.deliveryState).toBe("sent");
  });

  it("does not overwrite a sent group row with failed (F5-2 CAS)", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const channelId = `${OWNER}:chan-1`;
    await StorageService.saveGroupMessage({
      ownerPubky: OWNER,
      channelId,
      eventId: EVENT,
      senderPubky: OWNER,
      kind: GROUP_MESSAGE_KIND,
      body: "hello",
      rawJson: '{"k":1}',
      sentAt: 40,
      receivedAt: null,
      deliveryState: "sending",
      replyToEventId: null,
      replyToAuthorPubky: null,
      targetEventId: null,
      targetAuthorPubky: null,
      editedAt: null,
      deleted: false,
    });

    await StorageService.updateGroupMessageDeliveryState(
      OWNER,
      channelId,
      OWNER,
      EVENT,
      "sent",
    );
    await StorageService.updateGroupMessageDeliveryState(
      OWNER,
      channelId,
      OWNER,
      EVENT,
      "failed",
    );

    const row = await StorageService.getGroupMessage(OWNER, channelId, OWNER, EVENT);
    expect(row?.deliveryState).toBe("sent");
  });

  it("excludes the current item from the remaining-queue count (F5-3)", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.enqueue({
      id: "q-only",
      messageId: EVENT,
      recipientPubky: PEER,
      payload: JSON.stringify({ type: "link.group.fanout", ownerPubky: OWNER }),
      attempts: 9,
      nextRetryAt: 40,
      createdAt: 40,
    });

    expect(await StorageService.countDeliveryQueueForMessage(EVENT)).toBe(1);
    expect(
      await StorageService.countDeliveryQueueForMessage(EVENT, { excludeItemId: "q-only" }),
    ).toBe(0);
  });

  it("removes only the current owner's queue items for a recipient (F5-4)", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const otherOwner = OTHER;
    await StorageService.enqueue({
      id: "q-own",
      messageId: EVENT,
      recipientPubky: PEER,
      payload: JSON.stringify({ type: "link.chat.message", ownerPubky: OWNER }),
      attempts: 1,
      nextRetryAt: 40,
      createdAt: 40,
    });
    await StorageService.enqueue({
      id: "q-other",
      messageId: "00000000-0000-4000-8000-0000000000aa",
      recipientPubky: PEER,
      payload: JSON.stringify({ type: "link.chat.message", ownerPubky: otherOwner }),
      attempts: 1,
      nextRetryAt: 40,
      createdAt: 40,
    });

    await StorageService.removeQueueItemsForRecipient(PEER, OWNER);

    expect(await StorageService.getDeliveryQueueItem("q-own")).toBeNull();
    expect(await StorageService.getDeliveryQueueItem("q-other")).not.toBeNull();
  });

  it("rolls queue drop and abandon in one transaction (F5 crash window)", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.persistLinkSendIntent({
      message: {
        ownerPubky: OWNER,
        eventId: EVENT,
        conversationId: `dm:${PEER}`,
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: "sent",
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"k":1}',
        body: "owed",
        sentAt: 40,
        receivedAt: null,
        deliveryState: "sending",
      },
      queueItem: {
        id: "q-owed",
        messageId: EVENT,
        recipientPubky: PEER,
        payload: JSON.stringify({ type: "link.chat.message", ownerPubky: OWNER }),
        attempts: 1,
        nextRetryAt: 40,
        createdAt: 40,
      },
    });

    const original = db.executeSync.bind(db);
    let inTxn = false;
    db.executeSync = (query: string, params: unknown[] = []) => {
      const sql = query.trim();
      if (
        inTxn &&
        /UPDATE\s+link_messages/i.test(sql) &&
        /delivery_state = 'failed'/.test(sql)
      ) {
        throw new Error("injected abandon failure");
      }
      const result = original(query, params as never);
      if (/^BEGIN\b/i.test(sql)) inTxn = true;
      if (/^(COMMIT|ROLLBACK)\b/i.test(sql)) inTxn = false;
      return result;
    };

    await expect(
      StorageService.removeQueueItemsAndAbandonOwedForPeer(OWNER, PEER),
    ).rejects.toThrow("injected abandon failure");

    db.executeSync = original;
    expect(await StorageService.getDeliveryQueueItem("q-owed")).not.toBeNull();
    const owed = await StorageService.listOwedOutboundLinkMessages(OWNER);
    expect(owed).toHaveLength(1);
    expect(owed[0]?.eventId).toBe(EVENT);
  });

  it("drops the queue and abandons owed DMs in a single transaction (F5 crash window)", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await StorageService.persistLinkSendIntent({
      message: {
        ownerPubky: OWNER,
        eventId: EVENT,
        conversationId: `dm:${PEER}`,
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: "sent",
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"k":1}',
        body: "owed",
        sentAt: 40,
        receivedAt: null,
        deliveryState: "sending",
      },
      queueItem: {
        id: "q-owed",
        messageId: EVENT,
        recipientPubky: PEER,
        payload: JSON.stringify({ type: "link.chat.message", ownerPubky: OWNER }),
        attempts: 1,
        nextRetryAt: 40,
        createdAt: 40,
      },
    });

    const statements: string[] = [];
    const original = db.executeSync.bind(db);
    db.executeSync = (query: string, params: unknown[] = []) => {
      statements.push(query.trim().replace(/\s+/g, " "));
      return original(query, params as never);
    };

    await StorageService.removeQueueItemsAndAbandonOwedForPeer(OWNER, PEER);

    db.executeSync = original;
    const begin = statements.findIndex((sql) => /^BEGIN IMMEDIATE/i.test(sql));
    const commit = statements.findIndex((sql) => /^COMMIT\b/i.test(sql));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(commit).toBeGreaterThan(begin);
    const txn = statements.slice(begin, commit + 1);
    expect(txn.some((sql) => /DELETE FROM delivery_queue/i.test(sql))).toBe(true);
    expect(txn.some((sql) => /UPDATE link_messages/i.test(sql))).toBe(true);
    expect(txn.filter((sql) => /^COMMIT\b/i.test(sql))).toHaveLength(1);
    expect(await StorageService.getDeliveryQueueItem("q-owed")).toBeNull();
    expect(await StorageService.listOwedOutboundLinkMessages(OWNER)).toEqual([]);
  });

  it("redacts retained stream data and evicts attachment material on tombstone", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    await KeyStore.setPubky(OWNER);
    await KeyStore.setAttachmentSecret(OWNER, PEER, ATTACH_EVENT, ATTACHMENT_SECRET);
    await StorageService.saveLinkMessage({
      ownerPubky: OWNER,
      eventId: ATTACH_EVENT,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: PEER,
      direction: "received",
      kind: CHAT_MESSAGE_KIND,
      rawJson: JSON.stringify({
        version: 1,
        kind: CHAT_MESSAGE_KIND,
        event_id: ATTACH_EVENT,
        sent_at: 1,
        body: "stream-secret",
      }),
      body: "stream-secret",
      sentAt: 1,
      receivedAt: 1,
      deliveryState: "delivered",
    });
    await StorageService.saveAttachment({
      ownerPubky: OWNER,
      eventId: ATTACH_EVENT,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: PEER,
      direction: "received",
      location: `/pub/hypercolor.app/v1/attachments/${ATTACH_EVENT}`,
      keyRef: KeyStore.attachmentKeyService(OWNER, PEER, ATTACH_EVENT),
      contentType: "image/png",
      size: 32,
      thumbnailLocation: null,
      localCachePath: null,
      createdAt: 1,
      updatedAt: 1,
      deliveryState: "delivered",
      resolveState: "ready",
    });
    await StorageService.saveLinkStreamItems([
      {
        id: "stream-target",
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: JSON.stringify({
          kind: CHAT_MESSAGE_KIND,
          event_id: ATTACH_EVENT,
          sent_at: 1,
          body: "stream-secret",
        }),
        receivedAt: 1,
      },
    ]);

    await StorageService.tombstoneLinkMessage({
      ownerPubky: OWNER,
      conversationId: `dm:${PEER}`,
      eventId: ATTACH_EVENT,
      senderPubky: PEER,
    });

    expect(await KeyStore.getAttachmentSecret(OWNER, PEER, ATTACH_EVENT)).toBeNull();
    expect(await StorageService.getAttachment(OWNER, PEER, ATTACH_EVENT)).toEqual(
      expect.objectContaining({ resolveState: "unavailable-from-backup" }),
    );
    const stream = await StorageService.getUnprocessedLinkStreamItems(OWNER, PEER);
    expect(stream[0]?.rawJson).not.toContain("stream-secret");
    expect(stream[0]?.rawJson).toContain('"deleted":true');
  });

  it("journals a failed attachment cache deletion before clearing its path", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const cachePath = "/tmp/plaintext-attachment";
    deleteCacheFilesMock.mockResolvedValueOnce([cachePath]);
    await StorageService.saveLinkMessage({
      ownerPubky: OWNER,
      eventId: ATTACH_EVENT,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: PEER,
      direction: "received",
      kind: CHAT_MESSAGE_KIND,
      rawJson: "{}",
      body: "secret",
      sentAt: 1,
      receivedAt: 1,
      deliveryState: "delivered",
    });
    await StorageService.saveAttachment({
      ownerPubky: OWNER,
      eventId: ATTACH_EVENT,
      conversationId: `dm:${PEER}`,
      channelId: null,
      senderPubky: PEER,
      direction: "received",
      location: `/pub/hypercolor.app/v1/attachments/${ATTACH_EVENT}`,
      keyRef: "attachment-key",
      contentType: "image/png",
      size: 32,
      thumbnailLocation: null,
      localCachePath: cachePath,
      createdAt: 1,
      updatedAt: 1,
      deliveryState: "delivered",
      resolveState: "ready",
    });

    await StorageService.tombstoneLinkMessage({
      ownerPubky: OWNER,
      conversationId: `dm:${PEER}`,
      eventId: ATTACH_EVENT,
      senderPubky: PEER,
    });

    expect(
      db.executeSync(
        `SELECT target_kind, target FROM pending_cleanup
         WHERE owner_pubky = ?`,
        [OWNER],
      ).rows,
    ).toEqual([{ target_kind: "cache", target: cachePath }]);
    expect((await StorageService.getAttachment(OWNER, PEER, ATTACH_EVENT))?.localCachePath).toBeNull();
  });

  it("drains an already-absent cache cleanup row", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    const cachePath = "/tmp/already-absent-attachment";
    db.executeSync(
      `INSERT INTO pending_cleanup (owner_pubky, target_kind, target, created_at)
       VALUES (?, 'cache', ?, 1)`,
      [OWNER, cachePath],
    );

    await StorageService.retryPendingCleanup();

    expect(
      db.executeSync(
        `SELECT target_kind, target FROM pending_cleanup
         WHERE owner_pubky = ?`,
        [OWNER],
      ).rows,
    ).toEqual([]);
    expect(deleteCacheFilesMock).toHaveBeenCalledWith([cachePath]);
  });
});
