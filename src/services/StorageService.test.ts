/**
 * StorageService against real v13 SQL (better-sqlite3) and real WebKeyStore
 * (fake-indexeddb). Mobile mocks KeyStore; web exercises the async methods.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setDbForTests } from "../db";
import { openMemoryDb } from "../db/__tests__/betterSqliteAdapter";
import { runMigrations } from "../db/migrations";
import { CHAT_MESSAGE_KIND } from "../types/link";
import { KeyStore } from "./KeyStore";
import { StorageService } from "./StorageService";

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
  });

  afterEach(() => {
    setDbForTests(null);
  });

  it("migrates to v13, inserts and reads a contact and a link", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(
      13,
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

    await StorageService.clearAccountData(OWNER);

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
});
