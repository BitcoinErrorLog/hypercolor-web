import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendPrivate = vi.fn();
const restoreLink = vi.fn();
const initiateLink = vi.fn();
const probeInbound = vi.fn();
const advanceHandshake = vi.fn();
const getMarker = vi.fn();
const persistIntent = vi.fn();
const finalizeSend = vi.fn();
const getLink = vi.fn();
const getReceiver = vi.fn();
const getMessageRequest = vi.fn();
const getPubky = vi.fn();
const receivePrivate = vi.fn();

vi.mock("./PaykitLinkWeb", async () => {
  const actual = await vi.importActual<typeof import("./PaykitLinkWeb")>("./PaykitLinkWeb");
  return {
    ...actual,
    PaykitLinkWeb: {
      isAvailable: () => true,
      signinWithSecret: vi.fn(),
      startAuthFlow: vi.fn(),
      awaitAuthApproval: vi.fn(),
      signOutSession: vi.fn(),
      putPublic: vi.fn(),
      deletePublic: vi.fn(),
      getReceiverMarker: (...args: unknown[]) => getMarker(...args),
      initiateLink: (...args: unknown[]) => initiateLink(...args),
      probeInboundLink: (...args: unknown[]) => probeInbound(...args),
      advanceHandshake: (...args: unknown[]) => advanceHandshake(...args),
      restoreHandshake: vi.fn(),
      restoreLink: (...args: unknown[]) => restoreLink(...args),
      sendPrivateMessageJson: (...args: unknown[]) => sendPrivate(...args),
      receivePrivateMessages: (...args: unknown[]) => receivePrivate(...args),
      clearLinkOutbox: vi.fn(),
      closeLink: vi.fn(),
    },
  };
});

vi.mock("@/services/StorageService", () => ({
  StorageService: {
    retryPendingCleanup: vi.fn(async () => undefined),
    getLinkReceiver: (...args: unknown[]) => getReceiver(...args),
    getLink: (...args: unknown[]) => getLink(...args),
    getAllLinks: vi.fn(async () => []),
    upsertLink: vi.fn(),
    updateLinkSnapshot: vi.fn(),
    incrementLinkConsecutiveFailures: vi.fn(),
    resetLinkConsecutiveFailures: vi.fn(),
    deleteLink: vi.fn(),
    persistLinkSendIntent: (...args: unknown[]) => persistIntent(...args),
    finalizeLinkSend: (...args: unknown[]) => finalizeSend(...args),
    listDeliveryQueue: vi.fn(async () => []),
    getDeliveryQueueItem: vi.fn(async () => null),
    listOwedOutboundLinkMessages: vi.fn(async () => []),
    abandonOwedLinkMessagesForPeer: vi.fn(),
    enqueue: vi.fn(),
    hasQueueItemForMessage: vi.fn(async () => false),
    getLinkMessageByEventId: vi.fn(),
    clearPaymentPendingEvent: vi.fn(),
    removeQueueItemsForRecipient: vi.fn(),
    deleteLinkStreamItemsForPeer: vi.fn(),
    deleteLinkMessagesForPeer: vi.fn(),
    getGroupMessage: vi.fn(),
    removeFromQueue: vi.fn(),
    getMessageRequest: (...args: unknown[]) => getMessageRequest(...args),
    upsertMessageRequest: vi.fn(),
    getContact: vi.fn(async () => null),
    getAllContacts: vi.fn(async () => []),
    countLinkMessagesForPeer: vi.fn(async () => 0),
    getUnprocessedLinkStreamItems: vi.fn(async () => []),
    saveLinkStreamItems: vi.fn(),
    markLinkStreamItemProcessed: vi.fn(),
    saveLinkMessage: vi.fn(),
    hasLinkMessage: vi.fn(async () => false),
    getLinkMessage: vi.fn(),
    listPaymentRequestsWithPendingEvent: vi.fn(async () => []),
    hasGroupMessage: vi.fn(async () => true),
    finalizeGroupFanoutSend: vi.fn(),
    countDeliveryQueueForMessage: vi.fn(async () => 0),
    updateGroupMessageDeliveryState: vi.fn(),
    updateLinkMessageDeliveryState: vi.fn(),
    updateAttachmentDelivery: vi.fn(),
    markGroupEventSeen: vi.fn(),
    clearAccountData: vi.fn(),
  },
}));

vi.mock("@/services/KeyStore", () => ({
  KeyStore: {
    getPubky: (...args: unknown[]) => getPubky(...args),
    setPubky: vi.fn(),
    setAttachmentSecret: vi.fn(),
    getAttachmentSecret: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("@/services/RetryQueue", () => ({
  isRetired: vi.fn(() => false),
  RetryQueue: {
    getDue: vi.fn(async () => []),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    defer: vi.fn(),
    park: vi.fn(),
  },
}));

vi.mock("./session", () => ({
  adoptApprovedSession: vi.fn(),
  adoptLiveHandle: vi.fn(async (handle: { pubky: () => string }) => ({
    handle,
    pubky: handle.pubky(),
  })),
  getLiveSession: vi.fn(() => null),
  restoreSessionOnLoad: vi.fn(async () => ({ status: "needs-enable" })),
  signOut: vi.fn(),
  getEnableStatus: vi.fn(async () => "enabled"),
}));

vi.mock("../group/applyGroupInbound", () => ({
  applyGroupInbound: vi.fn(),
}));
vi.mock("../attachments/applyAttachmentInbound", () => ({
  applyAttachmentInbound: vi.fn(),
}));
vi.mock("../payments/applyPaymentInbound", () => ({
  applyPaymentInbound: vi.fn(),
}));
vi.mock("../attachments/redaction", () => ({
  reconstructAttachmentWireJson: vi.fn(async (raw: string) => raw),
  fingerprintStoredAttachmentSecret: vi.fn(async () => "fp-test"),
}));
vi.mock("./provisionReceiver", () => ({
  provisionReceiver: vi.fn(),
}));

import { RetryQueue, isRetired } from "@/services/RetryQueue";
import { StorageService } from "@/services/StorageService";
import { reconstructAttachmentWireJson } from "../attachments/redaction";
import {
  LINK_GROUP_FANOUT_PAYLOAD_TYPE,
  LINK_RETRY_PAYLOAD_TYPE,
  LinkService,
  buildPreparedSendIntent,
  resetLinkServiceHarnessState,
} from "./LinkService";
import { CHAT_MESSAGE_KIND, LINK_RECEIVER_PATH } from "../../types/link";
import { CHAT_ATTACHMENT_KIND } from "../../types/attachment";

const OWNER = "a".repeat(52);
const PEER = "z".repeat(52);
const NOW = 1_700_000_000_000;
const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const QUEUE_ID = "00000000-0000-4000-8000-000000000099";

function handle() {
  return { pubky: () => OWNER, free: vi.fn() };
}

describe("LinkService persist-then-send", () => {
  beforeEach(async () => {
    resetLinkServiceHarnessState();
    persistIntent.mockReset().mockResolvedValue(undefined);
    finalizeSend.mockReset().mockResolvedValue(undefined);
    sendPrivate.mockReset().mockResolvedValue({ snapshot: "est-2" });
    restoreLink.mockReset().mockResolvedValue({ linkId: "handle-1" });
    probeInbound.mockReset().mockResolvedValue({ result: "none" });
    getMarker.mockReset().mockResolvedValue({
      noisePublicKey: "peer-noise",
      capabilitiesJson: "{}",
    });
    getMessageRequest.mockReset().mockResolvedValue(null);
    getPubky.mockReset().mockResolvedValue(OWNER);
    getReceiver.mockReset().mockResolvedValue({
      ownerPubky: OWNER,
      receiverAlias: "recv",
      receiverPath: LINK_RECEIVER_PATH,
      markerPublished: true,
    });
    getLink.mockReset().mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "initiator",
      status: "established",
      snapshot: "HC1.opaque",
      remoteNoisePublicKey: "peer-noise",
      localReceiverPath: LINK_RECEIVER_PATH,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
      updatedAt: NOW,
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(EVENT_ID)
      .mockReturnValue(QUEUE_ID);
    vi.mocked(RetryQueue.getDue).mockReset().mockResolvedValue([]);
    vi.mocked(RetryQueue.recordFailure).mockReset().mockResolvedValue(false);
    vi.mocked(RetryQueue.defer).mockReset();
    vi.mocked(RetryQueue.park).mockReset();
    vi.mocked(RetryQueue.recordSuccess).mockReset();
    vi.mocked(isRetired).mockReset().mockReturnValue(false);
    vi.mocked(StorageService.updateGroupMessageDeliveryState).mockReset();
    vi.mocked(StorageService.updateLinkMessageDeliveryState).mockReset();
    vi.mocked(StorageService.getLinkMessage).mockReset();
    vi.mocked(StorageService.getGroupMessage).mockReset();
    vi.mocked(StorageService.listDeliveryQueue).mockReset().mockResolvedValue([]);
    vi.mocked(StorageService.getDeliveryQueueItem).mockReset().mockResolvedValue(null);
    vi.mocked(StorageService.listOwedOutboundLinkMessages).mockReset().mockResolvedValue([]);
    vi.mocked(StorageService.enqueue).mockReset();
    vi.mocked(StorageService.hasQueueItemForMessage).mockReset().mockResolvedValue(false);
    vi.mocked(StorageService.getLinkMessageByEventId).mockReset();
    vi.mocked(StorageService.listPaymentRequestsWithPendingEvent).mockReset().mockResolvedValue([]);
    vi.mocked(StorageService.updateAttachmentDelivery).mockReset();
    vi.mocked(StorageService.countDeliveryQueueForMessage).mockReset().mockResolvedValue(0);
    vi.mocked(reconstructAttachmentWireJson).mockReset().mockImplementation(async (raw: string) => raw);
    await LinkService.adoptHarnessSession(handle() as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetLinkServiceHarnessState();
  });

  it("persists the sending row and exact rawJson before send, then finalizes", async () => {
    const message = await LinkService.sendDm(PEER, "  hello  ");
    const json = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: EVENT_ID,
      sent_at: NOW,
      body: "hello",
    });

    expect(persistIntent).toHaveBeenCalledWith({
      message: expect.objectContaining({
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: json,
        deliveryState: "sending",
      }),
      queueItem: expect.objectContaining({
        messageId: EVENT_ID,
        recipientPubky: PEER,
        payload: JSON.stringify({
          type: LINK_RETRY_PAYLOAD_TYPE,
          ownerPubky: OWNER,
          peerPubky: PEER,
          senderPubky: OWNER,
          kind: CHAT_MESSAGE_KIND,
          eventId: EVENT_ID,
          rawJson: json,
        }),
      }),
    });
    expect(sendPrivate).toHaveBeenCalledWith("handle-1", json);
    expect(finalizeSend).toHaveBeenCalledWith({
      ownerPubky: OWNER,
      peerPubky: PEER,
      senderPubky: OWNER,
      kind: CHAT_MESSAGE_KIND,
      eventId: EVENT_ID,
      snapshot: "est-2",
      queueId: QUEUE_ID,
    });
    expect(message.deliveryState).toBe("sent");

    const persistOrder = persistIntent.mock.invocationCallOrder[0]!;
    const sendOrder = sendPrivate.mock.invocationCallOrder[0]!;
    const finalizeOrder = finalizeSend.mock.invocationCallOrder[0]!;
    expect(persistOrder).toBeLessThan(sendOrder);
    expect(sendOrder).toBeLessThan(finalizeOrder);
  });

  it("leaves the queued rawJson for retry when send fails", async () => {
    sendPrivate.mockRejectedValueOnce({ code: "network", message: "network error" });
    const message = await LinkService.sendDm(PEER, "hello");
    expect(persistIntent).toHaveBeenCalledTimes(1);
    expect(finalizeSend).not.toHaveBeenCalled();
    expect(message.deliveryState).toBe("sending");
    const queued = persistIntent.mock.calls[0]?.[0] as {
      queueItem: { payload: string };
    };
    const payload = JSON.parse(queued.queueItem.payload) as { rawJson: string };
    expect(payload.rawJson).toContain('"body":"hello"');
  });

  it("marks the row failed when the transport write is aborted, not left sending", async () => {
    sendPrivate.mockRejectedValueOnce(new Error("net::ERR_ABORTED"));

    const message = await LinkService.sendDm(PEER, "hello");

    expect(message.deliveryState).toBe("failed");
    expect(StorageService.updateLinkMessageDeliveryState).toHaveBeenCalledWith(
      OWNER,
      OWNER,
      CHAT_MESSAGE_KIND,
      EVENT_ID,
      "failed",
    );
    // The queue item survives a failed send: it is what re-attempts the write.
    expect(RetryQueue.recordSuccess).not.toHaveBeenCalled();
  });

  it("re-attempts the write when a retry drains a failed row", async () => {
    sendPrivate.mockRejectedValueOnce(new Error("net::ERR_ABORTED"));
    await LinkService.sendDm(PEER, "hello");
    const queued = persistIntent.mock.calls[0]?.[0] as {
      queueItem: { payload: string };
    };
    expect(sendPrivate).toHaveBeenCalledTimes(1);

    vi.mocked(StorageService.getLinkMessage).mockResolvedValue({
      ownerPubky: OWNER,
      senderPubky: OWNER,
      kind: CHAT_MESSAGE_KIND,
      eventId: EVENT_ID,
      deliveryState: "failed",
    } as never);
    vi.mocked(RetryQueue.getDue).mockResolvedValueOnce([
      {
        id: QUEUE_ID,
        messageId: EVENT_ID,
        recipientPubky: PEER,
        payload: queued.queueItem.payload,
        attempts: 1,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    ]);

    await LinkService.retryPendingSends();

    expect(sendPrivate).toHaveBeenCalledTimes(2);
    expect(finalizeSend).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT_ID, queueId: QUEUE_ID }),
    );
  });

  it("settles the queue item without re-sending once the row is sent", async () => {
    await LinkService.sendDm(PEER, "hello");
    const queued = persistIntent.mock.calls[0]?.[0] as {
      queueItem: { payload: string };
    };
    expect(sendPrivate).toHaveBeenCalledTimes(1);

    vi.mocked(StorageService.getLinkMessage).mockResolvedValue({
      ownerPubky: OWNER,
      senderPubky: OWNER,
      kind: CHAT_MESSAGE_KIND,
      eventId: EVENT_ID,
      deliveryState: "sent",
    } as never);
    vi.mocked(RetryQueue.getDue).mockResolvedValueOnce([
      {
        id: QUEUE_ID,
        messageId: EVENT_ID,
        recipientPubky: PEER,
        payload: queued.queueItem.payload,
        attempts: 1,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    ]);

    await LinkService.retryPendingSends();

    expect(sendPrivate).toHaveBeenCalledTimes(1);
    expect(RetryQueue.recordSuccess).toHaveBeenCalledWith(QUEUE_ID);
  });

  it("marks group fanout failed when RetryQueue permanently drops the last recipient", async () => {
    const channelId = `${OWNER}:chan-1`;
    const rawJson = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: EVENT_ID,
      sent_at: NOW,
      body: "group hello",
    });
    vi.mocked(RetryQueue.getDue).mockResolvedValueOnce([
      {
        id: QUEUE_ID,
        messageId: EVENT_ID,
        recipientPubky: PEER,
        payload: JSON.stringify({
          type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
          ownerPubky: OWNER,
          peerPubky: PEER,
          senderPubky: OWNER,
          kind: CHAT_MESSAGE_KIND,
          eventId: EVENT_ID,
          channelId,
          rawJson,
        }),
        attempts: 9,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    ]);
    vi.mocked(RetryQueue.recordFailure).mockResolvedValueOnce(true);
    sendPrivate.mockRejectedValueOnce({ code: "protocol", message: "protocol error" });
    vi.mocked(StorageService.getGroupMessage).mockResolvedValue({
      deliveryState: "sending",
    } as never);
    vi.mocked(StorageService.listDeliveryQueue).mockResolvedValue([
      {
        id: QUEUE_ID,
        messageId: EVENT_ID,
        recipientPubky: PEER,
        payload: JSON.stringify({
          type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
          ownerPubky: OWNER,
          peerPubky: PEER,
          senderPubky: OWNER,
          kind: CHAT_MESSAGE_KIND,
          eventId: EVENT_ID,
          channelId,
          rawJson,
        }),
        attempts: 9,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    ]);

    await LinkService.drainRetries();

    expect(StorageService.updateGroupMessageDeliveryState).toHaveBeenCalledWith(
      OWNER,
      channelId,
      OWNER,
      EVENT_ID,
      "failed",
    );
    expect(StorageService.updateGroupMessageDeliveryState).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "sent",
    );
  });

  it("drains an owed same-peer write before encrypting a new send", async () => {
    const owedEventId = "00000000-0000-4000-8000-000000000002";
    const owedJson = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: owedEventId,
      sent_at: NOW - 1,
      body: "old",
    });
    const owedItem = {
      id: "owed-q",
      messageId: owedEventId,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_RETRY_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        eventId: owedEventId,
        rawJson: owedJson,
      }),
      attempts: 1,
      nextRetryAt: NOW,
      createdAt: NOW - 1_000,
    };
    // Stateful queue mock: a successful delivery removes its row (as the
    // real finalize/recordSuccess does), so the pre-encrypt re-scan sees
    // the settled state instead of re-delivering.
    let queue = [owedItem];
    vi.mocked(StorageService.listDeliveryQueue).mockImplementation(async () => queue);
    vi.mocked(RetryQueue.recordSuccess).mockImplementation(async (id: string) => {
      queue = queue.filter((row) => row.id !== id);
    });
    vi.mocked(StorageService.getLinkMessage).mockImplementation(async (_o, _s, _k, eventId) => {
      if (eventId === owedEventId) {
        return { deliveryState: "failed" } as never;
      }
      return { deliveryState: "sending" } as never;
    });

    await LinkService.sendDm(PEER, "new");

    expect(sendPrivate).toHaveBeenCalledTimes(2);
    expect(sendPrivate.mock.calls[0]?.[1]).toBe(owedJson);
    expect(String(sendPrivate.mock.calls[1]?.[1])).toContain('"body":"new"');
    const owedOrder = sendPrivate.mock.invocationCallOrder[0]!;
    const newOrder = sendPrivate.mock.invocationCallOrder[1]!;
    expect(owedOrder).toBeLessThan(newOrder);
  });

  it("blocks a new encrypt when the owed same-peer retry stays failed", async () => {
    const owedEventId = "00000000-0000-4000-8000-000000000002";
    const owedJson = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: owedEventId,
      sent_at: NOW - 1,
      body: "old",
    });
    vi.mocked(StorageService.listDeliveryQueue).mockResolvedValue([
      {
        id: "owed-q",
        messageId: owedEventId,
        recipientPubky: PEER,
        payload: JSON.stringify({
          type: LINK_RETRY_PAYLOAD_TYPE,
          ownerPubky: OWNER,
          peerPubky: PEER,
          senderPubky: OWNER,
          kind: CHAT_MESSAGE_KIND,
          eventId: owedEventId,
          rawJson: owedJson,
        }),
        attempts: 1,
        nextRetryAt: NOW,
        createdAt: NOW - 1_000,
      },
    ]);
    vi.mocked(StorageService.getLinkMessage).mockResolvedValue({
      deliveryState: "failed",
    } as never);
    sendPrivate.mockRejectedValue({ code: "protocol", message: "hard fail" });

    const message = await LinkService.sendDm(PEER, "new");

    expect(sendPrivate).toHaveBeenCalledTimes(1);
    expect(sendPrivate.mock.calls[0]?.[1]).toBe(owedJson);
    expect(message.deliveryState).toBe("failed");
    expect(StorageService.updateLinkMessageDeliveryState).toHaveBeenCalledWith(
      OWNER,
      OWNER,
      CHAT_MESSAGE_KIND,
      EVENT_ID,
      "failed",
    );
  });

  it("keeps blocking a newer same-peer encrypt while a capped item is parked (R4-F1)", async () => {
    const owedEventId = "00000000-0000-4000-8000-000000000002";
    const owedJson = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: owedEventId,
      sent_at: NOW - 1,
      body: "old",
    });
    vi.mocked(StorageService.listDeliveryQueue).mockResolvedValue([
      {
        id: "owed-q",
        messageId: owedEventId,
        recipientPubky: PEER,
        payload: JSON.stringify({
          type: LINK_RETRY_PAYLOAD_TYPE,
          ownerPubky: OWNER,
          peerPubky: PEER,
          senderPubky: OWNER,
          kind: CHAT_MESSAGE_KIND,
          eventId: owedEventId,
          rawJson: owedJson,
        }),
        attempts: 10,
        nextRetryAt: NOW + 365 * 24 * 60 * 60 * 1000,
        createdAt: NOW - 1_000,
      },
    ]);
    vi.mocked(StorageService.getLinkMessage).mockImplementation(async (_o, _s, _k, eventId) => {
      if (eventId === owedEventId) return { deliveryState: "failed" } as never;
      return { deliveryState: "sending" } as never;
    });
    vi.mocked(isRetired).mockImplementation((item) => item.attempts >= 10);

    const message = await LinkService.sendDm(PEER, "new");

    // The parked capped item is still owed: it re-parks, and the new
    // plaintext is never encrypted at the possibly-committed nonce.
    expect(sendPrivate).not.toHaveBeenCalled();
    expect(RetryQueue.park).toHaveBeenCalledWith("owed-q");
    expect(message.deliveryState).toBe("failed");
  });

  it("does not heal a terminally failed DM even if its queue item is gone (R4-F4)", async () => {
    vi.mocked(StorageService.listOwedOutboundLinkMessages).mockResolvedValue([
      {
        ownerPubky: OWNER,
        eventId: EVENT_ID,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"k":1}',
        sentAt: NOW - 5_000,
        deliveryState: "failed",
      },
    ] as never);
    vi.mocked(StorageService.hasQueueItemForMessage).mockResolvedValue(false);

    await LinkService.recoverPendingSends();

    expect(StorageService.enqueue).not.toHaveBeenCalled();
  });

  it("does not resurrect a parked capped item with attempts reset via the heal (R4-F1)", async () => {
    vi.mocked(StorageService.listOwedOutboundLinkMessages).mockResolvedValue([
      {
        ownerPubky: OWNER,
        eventId: EVENT_ID,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: '{"k":1}',
        sentAt: NOW - 5_000,
        deliveryState: "failed",
      },
    ] as never);
    // The parked item still occupies the queue for this message.
    vi.mocked(StorageService.hasQueueItemForMessage).mockResolvedValue(true);

    await LinkService.recoverPendingSends();

    expect(StorageService.enqueue).not.toHaveBeenCalled();
  });

  it("defers instead of encrypting when an older owed item appears between entry scan and encrypt (R4-F2)", async () => {
    const olderEvent = "00000000-0000-4000-8000-00000000000e";
    const currentEvent = "00000000-0000-4000-8000-00000000000f";
    const olderItem = dmQueueItem({
      id: "q-older",
      eventId: olderEvent,
      body: "older-heal",
      createdAt: NOW - 5_000,
      nextRetryAt: NOW,
    });
    const currentItem = dmQueueItem({
      id: "q-current",
      eventId: currentEvent,
      body: "current",
      createdAt: NOW - 1_000,
      nextRetryAt: NOW,
    });
    vi.mocked(RetryQueue.getDue).mockResolvedValue([currentItem]);
    // Entry scan is clear; the older owed item (a simulated heal enqueue)
    // becomes visible only on the pre-encrypt re-scan.
    vi.mocked(StorageService.listDeliveryQueue)
      .mockResolvedValueOnce([currentItem])
      .mockResolvedValue([olderItem, currentItem]);
    vi.mocked(StorageService.getLinkMessage).mockResolvedValue({
      deliveryState: "failed",
    } as never);
    sendPrivate.mockRejectedValue({ code: "protocol", message: "hard fail" });

    await LinkService.drainRetries();

    // Only the older item was attempted; the current item deferred instead
    // of encrypting ahead of the older owed write.
    expect(sendPrivate).toHaveBeenCalledTimes(1);
    expect(sendPrivate.mock.calls[0]?.[1]).toBe(olderItem.rawJson);
    expect(RetryQueue.defer).toHaveBeenCalledWith("q-current", currentItem.attempts);
    expect(finalizeSend).not.toHaveBeenCalled();
  });

  it("resetEncryptedLink abandons owed DM rows and settles orphaned fan-out (R4-F4)", async () => {
    const channelId = `${OWNER}:chan-1`;
    vi.mocked(StorageService.listDeliveryQueue).mockResolvedValue([
      {
        id: "g-q",
        messageId: EVENT_ID,
        recipientPubky: PEER,
        payload: JSON.stringify({
          type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
          ownerPubky: OWNER,
          peerPubky: PEER,
          senderPubky: OWNER,
          kind: CHAT_MESSAGE_KIND,
          eventId: EVENT_ID,
          channelId,
          rawJson: '{"k":1}',
        }),
        attempts: 3,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    ]);
    vi.mocked(StorageService.getGroupMessage).mockResolvedValue({
      deliveryState: "sending",
    } as never);
    vi.mocked(StorageService.countDeliveryQueueForMessage).mockResolvedValue(0);

    await LinkService.resetEncryptedLink(PEER);

    expect(StorageService.removeQueueItemsForRecipient).toHaveBeenCalledWith(PEER);
    expect(StorageService.abandonOwedLinkMessagesForPeer).toHaveBeenCalledWith(OWNER, PEER);
    expect(StorageService.updateGroupMessageDeliveryState).toHaveBeenCalledWith(
      OWNER,
      channelId,
      OWNER,
      EVENT_ID,
      "failed",
    );
  });

  it("fails an attachment retry closed when reconstruction is rejected", async () => {
    const rawJson = JSON.stringify({ kind: "chat.attachment.v0", event_id: EVENT_ID });
    vi.mocked(reconstructAttachmentWireJson).mockRejectedValueOnce(
      new Error("Attachment key material changed"),
    );
    vi.mocked(StorageService.getLinkMessage).mockResolvedValue({
      deliveryState: "failed",
    } as never);
    const item = {
      id: QUEUE_ID,
      messageId: EVENT_ID,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_RETRY_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: "chat.attachment.v0",
        eventId: EVENT_ID,
        rawJson,
        secretFingerprint: "fp-original",
      }),
      attempts: 1,
      nextRetryAt: NOW,
      createdAt: NOW,
    };
    vi.mocked(RetryQueue.getDue).mockResolvedValueOnce([item]);

    await LinkService.drainRetries();

    expect(reconstructAttachmentWireJson).toHaveBeenCalled();
    expect(sendPrivate).not.toHaveBeenCalled();
    expect(RetryQueue.recordFailure).toHaveBeenCalledWith(QUEUE_ID, 1);
  });

  it("does not flip a sent DM to failed when a stale retire pass overlaps", async () => {
    const payload = JSON.stringify({
      type: LINK_RETRY_PAYLOAD_TYPE,
      ownerPubky: OWNER,
      peerPubky: PEER,
      senderPubky: OWNER,
      kind: CHAT_MESSAGE_KIND,
      eventId: EVENT_ID,
      rawJson: JSON.stringify({
        version: 1,
        kind: CHAT_MESSAGE_KIND,
        event_id: EVENT_ID,
        sent_at: NOW,
        body: "hello",
      }),
    });
    const item = {
      id: QUEUE_ID,
      messageId: EVENT_ID,
      recipientPubky: PEER,
      payload,
      attempts: 1,
      nextRetryAt: NOW,
      createdAt: NOW,
    };
    vi.mocked(RetryQueue.getDue).mockResolvedValue([item]);
    vi.mocked(StorageService.listDeliveryQueue).mockResolvedValue([item]);
    vi.mocked(StorageService.getLinkMessage).mockResolvedValue({
      deliveryState: "sending",
    } as never);

    let releaseSend!: (value: { snapshot: string }) => void;
    sendPrivate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSend = resolve;
        }),
    );

    const first = LinkService.drainRetries();
    await vi.waitFor(() => expect(sendPrivate).toHaveBeenCalledTimes(1));

    vi.mocked(isRetired).mockReturnValue(true);
    vi.mocked(StorageService.getLinkMessage).mockResolvedValue({
      deliveryState: "sent",
    } as never);
    const second = LinkService.drainRetries();
    releaseSend({ snapshot: "est-2" });
    await first;
    await second;

    expect(StorageService.updateLinkMessageDeliveryState).not.toHaveBeenCalledWith(
      OWNER,
      OWNER,
      CHAT_MESSAGE_KIND,
      EVENT_ID,
      "failed",
    );
  });

  function dmQueueItem(input: {
    id: string;
    eventId: string;
    body: string;
    createdAt: number;
    nextRetryAt: number;
  }) {
    const rawJson = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: input.eventId,
      sent_at: input.createdAt,
      body: input.body,
    });
    return {
      id: input.id,
      messageId: input.eventId,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_RETRY_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        eventId: input.eventId,
        rawJson,
      }),
      attempts: 1,
      nextRetryAt: input.nextRetryAt,
      createdAt: input.createdAt,
      rawJson,
    };
  }

  it("encrypts the older owed same-peer item before a newer item that is due first", async () => {
    const eventA = "00000000-0000-4000-8000-00000000000a";
    const eventB = "00000000-0000-4000-8000-00000000000b";
    const itemA = dmQueueItem({
      id: "q-a",
      eventId: eventA,
      body: "older-owed",
      createdAt: NOW - 2_000,
      nextRetryAt: NOW + 30_000,
    });
    const itemB = dmQueueItem({
      id: "q-b",
      eventId: eventB,
      body: "newer-due",
      createdAt: NOW - 1_000,
      nextRetryAt: NOW,
    });
    vi.mocked(RetryQueue.getDue).mockResolvedValue([itemB]);
    // Stateful queue mock: a successful delivery removes its row (as the
    // real finalize/recordSuccess does), so the pre-encrypt re-scan sees
    // the settled state instead of re-delivering.
    let queue = [itemA, itemB];
    vi.mocked(StorageService.listDeliveryQueue).mockImplementation(async () => queue);
    vi.mocked(RetryQueue.recordSuccess).mockImplementation(async (id: string) => {
      queue = queue.filter((row) => row.id !== id);
    });
    vi.mocked(StorageService.getLinkMessage).mockResolvedValue({
      deliveryState: "failed",
    } as never);

    let releaseA!: (value: { snapshot: string }) => void;
    sendPrivate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseA = resolve;
        }),
    );

    const drain = LinkService.drainRetries();
    await vi.waitFor(() => expect(sendPrivate).toHaveBeenCalledTimes(1));
    expect(sendPrivate.mock.calls[0]?.[1]).toBe(itemA.rawJson);
    expect(sendPrivate).toHaveBeenCalledTimes(1);

    releaseA({ snapshot: "est-a" });
    await drain;

    expect(sendPrivate).toHaveBeenCalledTimes(2);
    expect(sendPrivate.mock.calls[1]?.[1]).toBe(itemB.rawJson);
  });

  it("encrypts an older owed group fan-out before a newer same-peer item due first", async () => {
    const channelId = `${OWNER}:chan-1`;
    const eventA = "00000000-0000-4000-8000-00000000000c";
    const eventB = "00000000-0000-4000-8000-00000000000d";
    const jsonA = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: eventA,
      sent_at: NOW - 2_000,
      body: "older-group",
    });
    const jsonB = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: eventB,
      sent_at: NOW - 1_000,
      body: "newer-group",
    });
    const itemA = {
      id: "g-a",
      messageId: eventA,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        eventId: eventA,
        channelId,
        rawJson: jsonA,
      }),
      attempts: 1,
      nextRetryAt: NOW + 30_000,
      createdAt: NOW - 2_000,
    };
    const itemB = {
      id: "g-b",
      messageId: eventB,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        eventId: eventB,
        channelId,
        rawJson: jsonB,
      }),
      attempts: 1,
      nextRetryAt: NOW,
      createdAt: NOW - 1_000,
    };
    vi.mocked(RetryQueue.getDue).mockResolvedValue([itemB]);
    // Stateful queue mock: a successful delivery removes its row (as the
    // real finalize/recordSuccess does), so the pre-encrypt re-scan sees
    // the settled state instead of re-delivering.
    let queue = [itemA, itemB];
    vi.mocked(StorageService.listDeliveryQueue).mockImplementation(async () => queue);
    vi.mocked(RetryQueue.recordSuccess).mockImplementation(async (id: string) => {
      queue = queue.filter((row) => row.id !== id);
    });
    vi.mocked(StorageService.getGroupMessage).mockResolvedValue({
      deliveryState: "sending",
    } as never);

    await LinkService.drainRetries();

    expect(sendPrivate).toHaveBeenCalledTimes(2);
    expect(sendPrivate.mock.calls[0]?.[1]).toBe(jsonA);
    expect(sendPrivate.mock.calls[1]?.[1]).toBe(jsonB);
  });

  it("re-enqueues a payment pending send with the original sentAt createdAt", async () => {
    const sentAt = NOW - 8_000;
    const rawJson = JSON.stringify({
      version: 1,
      kind: CHAT_ATTACHMENT_KIND,
      event_id: EVENT_ID,
    });
    vi.mocked(StorageService.listPaymentRequestsWithPendingEvent).mockResolvedValue([
      { peerPubky: PEER, pendingEventId: EVENT_ID },
    ] as never);
    vi.mocked(StorageService.getLinkMessageByEventId).mockResolvedValue({
      eventId: EVENT_ID,
      peerPubky: PEER,
      rawJson,
      kind: CHAT_ATTACHMENT_KIND,
      deliveryState: "sending",
      sentAt,
    } as never);
    vi.mocked(StorageService.hasQueueItemForMessage).mockResolvedValue(false);

    await LinkService.recoverPendingSends();

    expect(StorageService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: EVENT_ID,
        createdAt: sentAt,
        payload: expect.stringContaining('"secretFingerprint":"fp-test"'),
      }),
    );
  });

  it("re-enqueues an owed DM whose queue item was lost, using original sentAt", async () => {
    const sentAt = NOW - 12_000;
    const rawJson = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: EVENT_ID,
      sent_at: sentAt,
      body: "lost-queue",
    });
    vi.mocked(StorageService.listOwedOutboundLinkMessages).mockResolvedValue([
      {
        ownerPubky: OWNER,
        eventId: EVENT_ID,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_MESSAGE_KIND,
        rawJson,
        sentAt,
        deliveryState: "sending",
      },
    ] as never);
    vi.mocked(StorageService.hasQueueItemForMessage).mockResolvedValue(false);

    await LinkService.recoverPendingSends();

    expect(StorageService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: EVENT_ID,
        recipientPubky: PEER,
        createdAt: sentAt,
      }),
    );
  });

  it("rejects attachment rotation on attemptPersistedSend using the stored fingerprint", async () => {
    const rawJson = JSON.stringify({ kind: CHAT_ATTACHMENT_KIND, event_id: EVENT_ID });
    const queued = {
      id: QUEUE_ID,
      messageId: EVENT_ID,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_RETRY_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_ATTACHMENT_KIND,
        eventId: EVENT_ID,
        rawJson,
        secretFingerprint: "fp-stored",
      }),
      attempts: 0,
      nextRetryAt: NOW,
      createdAt: NOW,
    };
    vi.mocked(StorageService.getDeliveryQueueItem).mockResolvedValue(queued);
    vi.mocked(StorageService.listDeliveryQueue).mockResolvedValue([queued]);
    vi.mocked(reconstructAttachmentWireJson).mockImplementation(
      async (_raw, _ref, expected) => {
        if (expected === "fp-stored") {
          throw new Error("Attachment key material changed");
        }
        return _raw;
      },
    );

    const result = await LinkService.attemptPersistedSend({
      peerPubky: PEER,
      kind: CHAT_ATTACHMENT_KIND,
      eventId: EVENT_ID,
      queueId: QUEUE_ID,
      rawJson,
    });

    expect(result).toBe("queued");
    expect(reconstructAttachmentWireJson).toHaveBeenCalledWith(
      rawJson,
      expect.any(String),
      "fp-stored",
    );
    expect(sendPrivate).not.toHaveBeenCalled();
  });

  it("rejects attachment rotation on sendPersistedLinkJson using the stored fingerprint", async () => {
    const rawJson = JSON.stringify({ kind: CHAT_ATTACHMENT_KIND, event_id: EVENT_ID });
    const queued = {
      id: QUEUE_ID,
      messageId: EVENT_ID,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_ATTACHMENT_KIND,
        eventId: EVENT_ID,
        channelId: `${OWNER}:chan-1`,
        rawJson,
        secretFingerprint: "fp-stored",
      }),
      attempts: 0,
      nextRetryAt: NOW,
      createdAt: NOW,
    };
    vi.mocked(StorageService.getDeliveryQueueItem).mockResolvedValue(queued);
    vi.mocked(StorageService.listDeliveryQueue).mockResolvedValue([queued]);
    vi.mocked(reconstructAttachmentWireJson).mockImplementation(
      async (_raw, _ref, expected) => {
        if (expected === "fp-stored") {
          throw new Error("Attachment key material changed");
        }
        return _raw;
      },
    );

    const result = await LinkService.sendPersistedLinkJson({
      peerPubky: PEER,
      queueId: QUEUE_ID,
      kind: CHAT_ATTACHMENT_KIND,
      eventId: EVENT_ID,
      rawJson,
      channelId: `${OWNER}:chan-1`,
    });

    expect(result).toBe("queued");
    expect(reconstructAttachmentWireJson).toHaveBeenCalledWith(
      rawJson,
      expect.any(String),
      "fp-stored",
    );
    expect(sendPrivate).not.toHaveBeenCalled();
  });

  it("persists secretFingerprint on buildPreparedSendIntent", async () => {
    const rawJson = JSON.stringify({
      version: 1,
      kind: CHAT_ATTACHMENT_KIND,
      event_id: EVENT_ID,
      key: "deadbeef",
    });
    const intent = await buildPreparedSendIntent({
      ownerPubky: OWNER,
      peerPubky: PEER,
      kind: CHAT_ATTACHMENT_KIND,
      eventId: EVENT_ID,
      rawJson,
      body: "Attachment",
      sentAt: NOW,
      queueId: QUEUE_ID,
    });
    const payload = JSON.parse(intent.queueItem.payload) as { secretFingerprint?: string };
    expect(payload.secretFingerprint).toBe("fp-test");
  });
});

const establishedLink = {
  ownerPubky: OWNER,
  peerPubky: PEER,
  role: "responder" as const,
  status: "established" as const,
  snapshot: "HC1.opaque",
  remoteNoisePublicKey: "peer-noise",
  localReceiverPath: LINK_RECEIVER_PATH,
  remoteReceiverPath: LINK_RECEIVER_PATH,
  consecutiveFailures: 0,
  updatedAt: NOW,
};

const followingContact = {
  pubky: PEER,
  ownerPubky: OWNER,
  trustScore: 0.2,
  isFollowing: true,
  isFollower: false,
  isMutual: false,
  addedManually: false,
  firstSeenAt: NOW,
};

describe("LinkService inbound accept gate", () => {
  beforeEach(async () => {
    resetLinkServiceHarnessState();
    receivePrivate.mockReset().mockResolvedValue({ messages: [], snapshot: "recv-1" });
    restoreLink.mockReset().mockResolvedValue({ linkId: "handle-1" });
    probeInbound.mockReset().mockResolvedValue({
      result: "established",
      linkId: "inbound-1",
      snapshot: "HC1.inbound",
    });
    getMarker.mockReset().mockResolvedValue({
      noisePublicKey: "peer-noise",
      capabilitiesJson: "{}",
    });
    getMessageRequest.mockReset().mockResolvedValue(null);
    getPubky.mockReset().mockResolvedValue(OWNER);
    getReceiver.mockReset().mockResolvedValue({
      ownerPubky: OWNER,
      receiverAlias: "recv",
      receiverPath: LINK_RECEIVER_PATH,
      markerPublished: true,
    });
    getLink.mockReset().mockResolvedValue(null);
    vi.mocked(StorageService.getContact).mockReset().mockResolvedValue(null);
    vi.mocked(StorageService.countLinkMessagesForPeer).mockReset().mockResolvedValue(0);
    vi.mocked(StorageService.upsertMessageRequest).mockReset();
    vi.mocked(StorageService.getUnprocessedLinkStreamItems).mockReset().mockResolvedValue([]);
    vi.mocked(RetryQueue.getDue).mockReset().mockResolvedValue([]);
    vi.mocked(isRetired).mockReset().mockReturnValue(false);
    vi.mocked(StorageService.listDeliveryQueue).mockReset().mockResolvedValue([]);
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    await LinkService.adoptHarnessSession(handle() as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetLinkServiceHarnessState();
  });

  it("holds a follow-only new inbound as a message request", async () => {
    vi.mocked(StorageService.getContact).mockResolvedValue(followingContact);

    const received = await LinkService.syncInbox([PEER]);

    expect(received).toEqual([]);
    expect(StorageService.upsertMessageRequest).toHaveBeenCalledWith({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: "pending",
    });
  });

  it("holds a mutual-follow new inbound as a message request", async () => {
    vi.mocked(StorageService.getContact).mockResolvedValue({
      ...followingContact,
      isFollowing: true,
      isFollower: true,
      isMutual: true,
    });

    await LinkService.syncInbox([PEER]);

    expect(StorageService.upsertMessageRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", peerPubky: PEER }),
    );
  });

  it("holds a manually added new inbound as a message request", async () => {
    vi.mocked(StorageService.getContact).mockResolvedValue({
      ...followingContact,
      isFollowing: false,
      addedManually: true,
    });

    await LinkService.syncInbox([PEER]);

    expect(StorageService.upsertMessageRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", peerPubky: PEER }),
    );
  });

  it("leaves an existing routed conversation accepted without a request row", async () => {
    getLink.mockResolvedValue(establishedLink);
    vi.mocked(StorageService.countLinkMessagesForPeer).mockResolvedValue(3);
    vi.mocked(StorageService.getContact).mockResolvedValue({
      ...followingContact,
      isMutual: true,
      addedManually: true,
    });

    const received = await LinkService.syncInbox([PEER]);

    expect(received).toEqual([]);
    expect(StorageService.upsertMessageRequest).not.toHaveBeenCalled();
    expect(receivePrivate).toHaveBeenCalledWith("handle-1");
  });
});
