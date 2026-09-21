import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendPrivate = vi.fn();
const restoreLink = vi.fn();
const initiateLink = vi.fn();
const probeInbound = vi.fn();
const advanceHandshake = vi.fn();
const restoreHandshake = vi.fn();
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
      publicGet: vi.fn(async (_peer: string, path: string) =>
        path.includes("/capabilities.json")
          ? new TextEncoder().encode(
              '{"version":1,"kind":"hypercolor.receiver.capabilities","receiver_path":"hypercolor/wallet","chat_kinds_v":1}',
            )
          : undefined,
      ),
      initiateLink: (...args: unknown[]) => initiateLink(...args),
      probeInboundLink: (...args: unknown[]) => probeInbound(...args),
      advanceHandshake: (...args: unknown[]) => advanceHandshake(...args),
      restoreHandshake: (...args: unknown[]) => restoreHandshake(...args),
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
    getHandshakeBudget: vi.fn(async () => null),
    upsertHandshakeBudget: vi.fn(),
    clearHandshakeBudget: vi.fn(),
    getLink: (...args: unknown[]) => getLink(...args),
    getAllLinks: vi.fn(async () => []),
    upsertLink: vi.fn(),
    recordLastSeenPeerMarkerPk: vi.fn(),
    recordPeerChatKindsV: vi.fn(),
    ensureChatDevicePrefs: vi.fn(async () => ({
      receiptsEnabled: true,
      typingEnabled: true,
      upgradeAt: 1,
      updatedAt: 1,
    })),
    enqueueControlPam: vi.fn(),
    finalizeControlSend: vi.fn(),
    getLinkMessagesForConversation: vi.fn(async () => []),
    getLinkReadCursor: vi.fn(async () => null),
    setLinkReadCursor: vi.fn(),
    updateLinkSnapshot: vi.fn(),
  markLinkReconnectRequired: vi.fn(),
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
    getAttachment: vi.fn(async () => null),
    tombstoneLinkMessage: vi.fn(),
    clearPaymentPendingEvent: vi.fn(),
    removeQueueItemsForRecipient: vi.fn(),
    removeQueueItemsAndAbandonOwedForPeer: vi.fn(),
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
    markLinkStreamItemProcessedWithError: vi.fn(),
    saveLinkMessage: vi.fn(),
    findLinkMessageInConversation: vi.fn(async () => null),
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
    deleteArchivedLink: vi.fn(),
    upsertArchivedLink: vi.fn(),
    getArchivedLink: vi.fn(),
    listPendingChatTags: vi.fn(async () => []),
    deletePendingChatTag: vi.fn(),
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
  nextAttemptAt: (attempts: number, now = Date.now()) =>
    now + Math.min(15_000 * 2 ** attempts, 30 * 60 * 1000),
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
  drainReceiverPublishRetry: vi.fn(async () => false),
  provisionReceiver: vi.fn(),
  syncOwnReceiverRole: vi.fn(),
  takeoverReceiver: vi.fn(),
}));

import { RetryQueue, isRetired } from "@/services/RetryQueue";
import { StorageService } from "@/services/StorageService";
import { reconstructAttachmentWireJson } from "../attachments/redaction";
import { PaykitLinkWeb } from "./PaykitLinkWeb";
import {
  LINK_CONTROL_PAYLOAD_TYPE,
  LINK_GROUP_FANOUT_PAYLOAD_TYPE,
  LINK_RETRY_PAYLOAD_TYPE,
  ESTABLISHED_REKEY_PARK_LIMIT,
  HANDSHAKE_PENDING_ADVANCE_LIMIT,
  HANDSHAKE_STALE_MS,
  LinkService,
  PEER_MARKER_REFRESH_TTL_MS,
  buildPreparedSendIntent,
  resetLinkServiceHarnessState,
} from "./LinkService";
import { CHAT_DELETE_KIND, CHAT_MESSAGE_KIND, CHAT_RECEIPT_KIND, LINK_RECEIVER_PATH } from "../../types/link";
import { resetChatKindsUpgradeReplayedForTests } from "./chatKindsAdvertisement";
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
    resetChatKindsUpgradeReplayedForTests();
    persistIntent.mockReset().mockResolvedValue(undefined);
    finalizeSend.mockReset().mockResolvedValue(undefined);
    sendPrivate.mockReset().mockResolvedValue({ snapshot: "est-2" });
    restoreLink.mockReset().mockResolvedValue({ linkId: "handle-1" });
    probeInbound.mockReset().mockResolvedValue({ result: "none" });
    getMarker.mockReset().mockResolvedValue({
      noisePublicKey: "peer-noise",
          });
    getMessageRequest.mockReset().mockResolvedValue(null);
    getPubky.mockReset().mockResolvedValue(OWNER);
    vi.mocked(StorageService.enqueueControlPam).mockReset();
    vi.mocked(StorageService.recordPeerChatKindsV).mockReset();
    vi.mocked(StorageService.getLinkReadCursor).mockReset().mockResolvedValue(null);
    vi.mocked(StorageService.getLinkMessagesForConversation).mockReset().mockResolvedValue([]);
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
    vi.mocked(StorageService.getAttachment).mockReset().mockResolvedValue(null);
    vi.mocked(StorageService.tombstoneLinkMessage).mockReset().mockResolvedValue(true);
    vi.mocked(StorageService.finalizeControlSend).mockReset().mockResolvedValue(undefined);
    vi.mocked(StorageService.listPaymentRequestsWithPendingEvent).mockReset().mockResolvedValue([]);
    vi.mocked(StorageService.updateAttachmentDelivery).mockReset();
    vi.mocked(StorageService.countDeliveryQueueForMessage).mockReset().mockResolvedValue(0);
    vi.mocked(StorageService.removeQueueItemsForRecipient).mockReset();
    vi.mocked(StorageService.removeQueueItemsAndAbandonOwedForPeer).mockReset();
    vi.mocked(StorageService.abandonOwedLinkMessagesForPeer).mockReset();
    vi.mocked(StorageService.getUnprocessedLinkStreamItems).mockReset().mockResolvedValue([]);
    vi.mocked(StorageService.countLinkMessagesForPeer).mockReset().mockResolvedValue(0);
    vi.mocked(StorageService.markLinkStreamItemProcessed).mockReset();
    vi.mocked(StorageService.saveLinkMessage).mockReset();
    vi.mocked(StorageService.hasLinkMessage).mockReset().mockResolvedValue(false);
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

  it("tombstones an owned message before dispatching one persisted delete PAM", async () => {
    const deleteEventId = "00000000-0000-4000-8000-0000000000de";
    const target = {
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: "sent" as const,
      kind: CHAT_MESSAGE_KIND,
      rawJson: JSON.stringify({ kind: CHAT_MESSAGE_KIND, event_id: EVENT_ID, body: "secret" }),
      body: "secret",
      sentAt: NOW,
      receivedAt: null,
      deliveryState: "sent" as const,
      deleted: false,
    };
    vi.mocked(StorageService.getLinkMessageByEventId).mockResolvedValue(target);
    vi.mocked(crypto.randomUUID)
      .mockReset()
      .mockReturnValueOnce(deleteEventId)
      .mockReturnValueOnce(QUEUE_ID);
    vi.mocked(StorageService.getDeliveryQueueItem).mockResolvedValue({
      id: QUEUE_ID,
      messageId: deleteEventId,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: "link.chat.control",
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_DELETE_KIND,
        eventId: deleteEventId,
        rawJson: JSON.stringify({
          version: 1,
          kind: CHAT_DELETE_KIND,
          event_id: deleteEventId,
          sent_at: NOW,
          target_event_id: EVENT_ID,
        }),
      }),
      attempts: 0,
      nextRetryAt: NOW,
      createdAt: NOW,
    });

    await LinkService.unsendDm(PEER, EVENT_ID);

    expect(StorageService.tombstoneLinkMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerPubky: OWNER,
        peerPubky: PEER,
        conversationId: `dm:${PEER}`,
        eventId: EVENT_ID,
        senderPubky: OWNER,
        controlQueueItem: expect.objectContaining({
          messageId: deleteEventId,
          recipientPubky: PEER,
          payload: expect.stringContaining(CHAT_DELETE_KIND),
        }),
      }),
    );
    expect(sendPrivate).toHaveBeenCalledWith(
      expect.anything(),
      JSON.stringify({
        version: 1,
        kind: CHAT_DELETE_KIND,
        event_id: deleteEventId,
        sent_at: NOW,
        target_event_id: EVENT_ID,
      }),
    );
    expect(StorageService.finalizeControlSend).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: QUEUE_ID, ownerPubky: OWNER, peerPubky: PEER }),
    );
    expect(StorageService.getDeliveryQueueItem).toHaveBeenCalledWith(QUEUE_ID);
    expect(sendPrivate).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch when the owned tombstone loses a race", async () => {
    const target = {
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: "sent" as const,
      kind: CHAT_MESSAGE_KIND,
      rawJson: "{}",
      body: "secret",
      sentAt: NOW,
      receivedAt: null,
      deliveryState: "sent" as const,
      deleted: false,
    };
    vi.mocked(StorageService.getLinkMessageByEventId).mockResolvedValue(target);
    vi.mocked(StorageService.tombstoneLinkMessage).mockResolvedValue(false);

    await LinkService.unsendDm(PEER, EVENT_ID);

    expect(sendPrivate).not.toHaveBeenCalled();
    expect(StorageService.finalizeControlSend).not.toHaveBeenCalled();
  });

  it("does not requeue a sending tombstone during startup recovery", async () => {
    vi.mocked(StorageService.listOwedOutboundLinkMessages).mockResolvedValue([
      {
        ownerPubky: OWNER,
        eventId: EVENT_ID,
        conversationId: `dm:${PEER}`,
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: "sent",
        kind: CHAT_MESSAGE_KIND,
        rawJson: JSON.stringify({ deleted: true }),
        body: "",
        sentAt: NOW,
        receivedAt: null,
        deliveryState: "sending",
        deleted: true,
      },
    ]);

    await LinkService.recoverPendingSends();

    expect(StorageService.enqueue).not.toHaveBeenCalled();
    expect(sendPrivate).not.toHaveBeenCalled();
  });

  it("does not dispatch an immediate control PAM when persistence lost the intent", async () => {
    const target = {
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: "sent" as const,
      kind: CHAT_MESSAGE_KIND,
      rawJson: "{}",
      body: "secret",
      sentAt: NOW,
      receivedAt: null,
      deliveryState: "sent" as const,
      deleted: false,
    };
    vi.mocked(StorageService.getLinkMessageByEventId).mockResolvedValue(target);
    vi.mocked(StorageService.tombstoneLinkMessage).mockResolvedValue(true);
    vi.mocked(StorageService.getDeliveryQueueItem).mockResolvedValue(null);

    await LinkService.unsendDm(PEER, EVENT_ID);

    expect(sendPrivate).not.toHaveBeenCalled();
    expect(StorageService.finalizeControlSend).not.toHaveBeenCalled();
  });

  it("aborts before mutation when ownership changes mid-flight", async () => {
    const target = {
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: "sent" as const,
      kind: CHAT_MESSAGE_KIND,
      rawJson: "{}",
      body: "secret",
      sentAt: NOW,
      receivedAt: null,
      deliveryState: "sent" as const,
      deleted: false,
    };
    vi.mocked(StorageService.getLinkMessageByEventId).mockResolvedValue(target);
    getPubky.mockResolvedValueOnce("b".repeat(52));

    await expect(LinkService.unsendDm(PEER, EVENT_ID)).rejects.toThrow(
      "Message is no longer available to unsend",
    );
    expect(StorageService.tombstoneLinkMessage).not.toHaveBeenCalled();
    expect(sendPrivate).not.toHaveBeenCalled();
  });

  it("defers a protocol-failed delete PAM and resends it after the link is ready", async () => {
    const deleteEventId = "00000000-0000-4000-8000-0000000000de";
    const rawJson = JSON.stringify({
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: deleteEventId,
      sent_at: NOW,
      target_event_id: EVENT_ID,
    });
    const controlItem = {
      id: QUEUE_ID,
      messageId: deleteEventId,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_CONTROL_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_DELETE_KIND,
        eventId: deleteEventId,
        rawJson,
      }),
      attempts: 0,
      nextRetryAt: NOW,
      createdAt: NOW,
    };
    const target = {
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: "sent" as const,
      kind: CHAT_MESSAGE_KIND,
      rawJson: "{}",
      body: "secret",
      sentAt: NOW,
      receivedAt: null,
      deliveryState: "sent" as const,
      deleted: false,
    };
    vi.mocked(StorageService.getLinkMessageByEventId).mockResolvedValue(target);
    vi.mocked(crypto.randomUUID)
      .mockReset()
      .mockReturnValueOnce(deleteEventId)
      .mockReturnValueOnce(QUEUE_ID);
    vi.mocked(StorageService.getDeliveryQueueItem).mockResolvedValue(controlItem);
    sendPrivate.mockRejectedValueOnce({ code: "protocol", message: "protocol error" });

    await LinkService.unsendDm(PEER, EVENT_ID);

    expect(StorageService.tombstoneLinkMessage).toHaveBeenCalled();
    expect(sendPrivate).toHaveBeenCalledTimes(1);
    expect(StorageService.finalizeControlSend).not.toHaveBeenCalled();
    expect(RetryQueue.recordFailure).not.toHaveBeenCalled();
    expect(RetryQueue.park).not.toHaveBeenCalled();
    expect(RetryQueue.defer).toHaveBeenCalledWith(QUEUE_ID, 0);
    expect(StorageService.markLinkReconnectRequired).not.toHaveBeenCalled();
    expect(PaykitLinkWeb.closeLink).toHaveBeenCalled();
    expect(PaykitLinkWeb.deletePublic).not.toHaveBeenCalled();

    sendPrivate.mockResolvedValue({ snapshot: "est-restored" });
    vi.mocked(RetryQueue.getDue).mockResolvedValueOnce([controlItem]);
    vi.mocked(RetryQueue.defer).mockClear();
    vi.mocked(PaykitLinkWeb.closeLink as ReturnType<typeof vi.fn>).mockClear();

    await LinkService.drainRetries();

    expect(sendPrivate).toHaveBeenCalledTimes(2);
    expect(StorageService.finalizeControlSend).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: QUEUE_ID, ownerPubky: OWNER, peerPubky: PEER }),
    );
    expect(RetryQueue.recordSuccess).toHaveBeenCalledWith(QUEUE_ID);
    expect(RetryQueue.recordFailure).not.toHaveBeenCalled();
    expect(RetryQueue.defer).not.toHaveBeenCalled();
  });

  it("defers in_flight control without dropping the live handle", async () => {
    const deleteEventId = "00000000-0000-4000-8000-0000000000de";
    const controlItem = {
      id: QUEUE_ID,
      messageId: deleteEventId,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_CONTROL_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_DELETE_KIND,
        eventId: deleteEventId,
        rawJson: JSON.stringify({
          version: 1,
          kind: CHAT_DELETE_KIND,
          event_id: deleteEventId,
          sent_at: NOW,
          target_event_id: EVENT_ID,
        }),
      }),
      attempts: 0,
      nextRetryAt: NOW,
      createdAt: NOW,
    };
    const target = {
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: "sent" as const,
      kind: CHAT_MESSAGE_KIND,
      rawJson: "{}",
      body: "secret",
      sentAt: NOW,
      receivedAt: null,
      deliveryState: "sent" as const,
      deleted: false,
    };
    vi.mocked(StorageService.getLinkMessageByEventId).mockResolvedValue(target);
    vi.mocked(crypto.randomUUID)
      .mockReset()
      .mockReturnValueOnce(deleteEventId)
      .mockReturnValueOnce(QUEUE_ID);
    vi.mocked(StorageService.getDeliveryQueueItem).mockResolvedValue(controlItem);
    sendPrivate.mockRejectedValueOnce({ code: "unavailable", message: "unavailable" });

    await LinkService.unsendDm(PEER, EVENT_ID);

    expect(RetryQueue.defer).toHaveBeenCalledWith(QUEUE_ID, 0);
    expect(RetryQueue.recordFailure).not.toHaveBeenCalled();
    expect(PaykitLinkWeb.closeLink).not.toHaveBeenCalled();
    expect(StorageService.finalizeControlSend).not.toHaveBeenCalled();
    expect(PaykitLinkWeb.deletePublic).not.toHaveBeenCalled();
  });

  it("holds a delete PAM through reconnect_required and sends it once the link is ready", async () => {
    const deleteEventId = "00000000-0000-4000-8000-0000000000de";
    const rawJson = JSON.stringify({
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: deleteEventId,
      sent_at: NOW,
      target_event_id: EVENT_ID,
    });
    const controlItem = {
      id: QUEUE_ID,
      messageId: deleteEventId,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_CONTROL_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_DELETE_KIND,
        eventId: deleteEventId,
        rawJson,
      }),
      attempts: 3,
      nextRetryAt: NOW,
      createdAt: NOW,
    };
    const target = {
      ownerPubky: OWNER,
      eventId: EVENT_ID,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: "sent" as const,
      kind: CHAT_MESSAGE_KIND,
      rawJson: "{}",
      body: "secret",
      sentAt: NOW,
      receivedAt: null,
      deliveryState: "sent" as const,
      deleted: false,
    };
    vi.mocked(StorageService.getLinkMessageByEventId).mockResolvedValue(target);
    vi.mocked(crypto.randomUUID)
      .mockReset()
      .mockReturnValueOnce(deleteEventId)
      .mockReturnValueOnce(QUEUE_ID);
    vi.mocked(StorageService.getDeliveryQueueItem).mockResolvedValue(controlItem);
    getLink.mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "initiator",
      status: "reconnect_required",
      snapshot: "est-dead",
      remoteNoisePublicKey: "peer-noise",
      localReceiverPath: LINK_RECEIVER_PATH,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
      updatedAt: NOW,
    });

    await LinkService.unsendDm(PEER, EVENT_ID);

    expect(sendPrivate).not.toHaveBeenCalled();
    expect(StorageService.finalizeControlSend).not.toHaveBeenCalled();
    expect(RetryQueue.defer).toHaveBeenCalledWith(QUEUE_ID, 3);
    expect(RetryQueue.recordFailure).not.toHaveBeenCalled();
    expect(PaykitLinkWeb.deletePublic).not.toHaveBeenCalled();

    getLink.mockResolvedValue({
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
    vi.mocked(RetryQueue.getDue).mockResolvedValueOnce([controlItem]);
    vi.mocked(RetryQueue.defer).mockClear();

    await LinkService.drainRetries();

    expect(sendPrivate).toHaveBeenCalledTimes(1);
    expect(StorageService.finalizeControlSend).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: QUEUE_ID }),
    );
    expect(RetryQueue.recordSuccess).toHaveBeenCalledWith(QUEUE_ID);
  });

  it("does not park a retired control PAM and skips send after the owner changes", async () => {
    const deleteEventId = "00000000-0000-4000-8000-0000000000de";
    const controlItem = {
      id: QUEUE_ID,
      messageId: deleteEventId,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_CONTROL_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_DELETE_KIND,
        eventId: deleteEventId,
        rawJson: "{}",
      }),
      attempts: 10,
      nextRetryAt: NOW,
      createdAt: NOW,
    };
    vi.mocked(isRetired).mockReturnValue(true);
    vi.mocked(RetryQueue.getDue).mockResolvedValueOnce([controlItem]);
    sendPrivate.mockRejectedValueOnce({ code: "protocol", message: "protocol error" });

    await LinkService.drainRetries();

    expect(RetryQueue.park).not.toHaveBeenCalled();
    expect(RetryQueue.recordFailure).not.toHaveBeenCalled();
    expect(RetryQueue.defer).toHaveBeenCalledWith(QUEUE_ID, 10);
    expect(StorageService.finalizeControlSend).not.toHaveBeenCalled();

    getPubky.mockResolvedValue("b".repeat(52));
    vi.mocked(RetryQueue.getDue).mockResolvedValueOnce([
      {
        ...controlItem,
        payload: JSON.stringify({
          type: LINK_CONTROL_PAYLOAD_TYPE,
          ownerPubky: "b".repeat(52),
          peerPubky: PEER,
          senderPubky: "b".repeat(52),
          kind: CHAT_DELETE_KIND,
          eventId: deleteEventId,
          rawJson: "{}",
        }),
      },
    ]);
    sendPrivate.mockClear();
    vi.mocked(RetryQueue.defer).mockClear();

    await LinkService.drainRetries();

    expect(sendPrivate).not.toHaveBeenCalled();
    expect(RetryQueue.defer).not.toHaveBeenCalled();
    expect(RetryQueue.recordSuccess).not.toHaveBeenCalled();
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

  it("re-attempts a cap-parked item at attempts 9 and blocks only if that retry fails (F5-1)", async () => {
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
        attempts: 9,
        nextRetryAt: NOW + 365 * 24 * 60 * 60 * 1000,
        createdAt: NOW - 1_000,
      },
    ]);
    vi.mocked(StorageService.getLinkMessage).mockImplementation(async (_o, _s, _k, eventId) => {
      if (eventId === owedEventId) return { deliveryState: "failed" } as never;
      return { deliveryState: "sending" } as never;
    });
    // Production isRetired: attempts maxes at 9, so the attempts>=10 arm
    // is unreachable; the drain re-attempts the same ciphertext.
    vi.mocked(isRetired).mockImplementation((item) => item.attempts >= 10);
    sendPrivate.mockRejectedValue({ code: "protocol", message: "hard fail" });
    vi.mocked(RetryQueue.recordFailure).mockResolvedValue(true);

    const message = await LinkService.sendDm(PEER, "new");

    expect(sendPrivate).toHaveBeenCalledTimes(1);
    expect(sendPrivate.mock.calls[0]?.[1]).toBe(owedJson);
    expect(RetryQueue.recordFailure).toHaveBeenCalledWith("owed-q", 9);
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

    expect(StorageService.removeQueueItemsAndAbandonOwedForPeer).toHaveBeenCalledWith(OWNER, PEER);
    expect(StorageService.removeQueueItemsForRecipient).not.toHaveBeenCalled();
    expect(StorageService.abandonOwedLinkMessagesForPeer).toHaveBeenCalledWith(OWNER, PEER);
    expect(StorageService.updateGroupMessageDeliveryState).toHaveBeenCalledWith(
      OWNER,
      channelId,
      OWNER,
      EVENT_ID,
      "failed",
    );
  });

  it("keeps a fully-delivered group row sent when reset settle races finalize (F5-2)", async () => {
    const channelId = `${OWNER}:chan-1`;
    let groupState: "sending" | "sent" | "delivered" | "failed" = "sending";
    vi.mocked(StorageService.listDeliveryQueue).mockResolvedValue([
      {
        id: "g-q-a",
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
        attempts: 1,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    ]);
    vi.mocked(StorageService.getGroupMessage).mockImplementation(
      async () => ({ deliveryState: groupState }) as never,
    );
    // Recipient B's finalize deletes its item and writes `sent` after
    // settle re-reads `sending` but before markFailed's CAS update.
    vi.mocked(StorageService.countDeliveryQueueForMessage).mockImplementation(async () => {
      groupState = "sent";
      return 0;
    });
    vi.mocked(StorageService.updateGroupMessageDeliveryState).mockImplementation(
      async (_o, _c, _s, _e, next) => {
        if (next === "failed" && (groupState === "sent" || groupState === "delivered")) return;
        groupState = next as typeof groupState;
      },
    );

    await LinkService.resetEncryptedLink(PEER);

    expect(groupState).toBe("sent");
    expect(StorageService.updateGroupMessageDeliveryState).toHaveBeenCalledWith(
      OWNER,
      channelId,
      OWNER,
      EVENT_ID,
      "failed",
    );
  });

  it("marks a group row failed at the cap when the parked item is the only remaining (F5-3)", async () => {
    const channelId = `${OWNER}:chan-1`;
    const rawJson = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: EVENT_ID,
      sent_at: NOW,
      body: "group hello",
    });
    const item = {
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
    };
    vi.mocked(RetryQueue.getDue).mockResolvedValueOnce([item]);
    vi.mocked(RetryQueue.recordFailure).mockResolvedValueOnce(true);
    sendPrivate.mockRejectedValueOnce({ code: "protocol", message: "protocol error" });
    vi.mocked(StorageService.getGroupMessage).mockResolvedValue({
      deliveryState: "sending",
    } as never);
    vi.mocked(StorageService.listDeliveryQueue).mockResolvedValue([item]);
    vi.mocked(StorageService.countDeliveryQueueForMessage).mockImplementation(
      async (_id, options) => (options?.excludeItemId === QUEUE_ID ? 0 : 1),
    );

    await LinkService.drainRetries();

    expect(StorageService.countDeliveryQueueForMessage).toHaveBeenCalledWith(EVENT_ID, {
      excludeItemId: QUEUE_ID,
    });
    expect(StorageService.updateGroupMessageDeliveryState).toHaveBeenCalledWith(
      OWNER,
      channelId,
      OWNER,
      EVENT_ID,
      "failed",
    );
  });

  it("leaves a second owner's queue rows untouched on reset and decline (F5-4)", async () => {
    const otherOwner = "b".repeat(52);
    const channelId = `${OWNER}:chan-1`;
    const otherEvent = "00000000-0000-4000-8000-0000000000aa";
    const ownItem = {
      id: "g-own",
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
      attempts: 1,
      nextRetryAt: NOW,
      createdAt: NOW,
    };
    const otherItem = {
      id: "g-other",
      messageId: otherEvent,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
        ownerPubky: otherOwner,
        peerPubky: PEER,
        senderPubky: otherOwner,
        kind: CHAT_MESSAGE_KIND,
        eventId: otherEvent,
        channelId: `${otherOwner}:chan-2`,
        rawJson: '{"k":2}',
      }),
      attempts: 1,
      nextRetryAt: NOW,
      createdAt: NOW,
    };
    vi.mocked(StorageService.listDeliveryQueue).mockResolvedValue([ownItem, otherItem]);
    vi.mocked(StorageService.getGroupMessage).mockResolvedValue({
      deliveryState: "sending",
    } as never);
    vi.mocked(StorageService.countDeliveryQueueForMessage).mockResolvedValue(0);

    await LinkService.resetEncryptedLink(PEER);

    expect(StorageService.removeQueueItemsAndAbandonOwedForPeer).toHaveBeenCalledWith(OWNER, PEER);
    expect(StorageService.updateGroupMessageDeliveryState).toHaveBeenCalledWith(
      OWNER,
      channelId,
      OWNER,
      EVENT_ID,
      "failed",
    );
    expect(StorageService.updateGroupMessageDeliveryState).not.toHaveBeenCalledWith(
      otherOwner,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    vi.mocked(StorageService.updateGroupMessageDeliveryState).mockClear();
    await LinkService.declineMessageRequest(PEER);

    expect(StorageService.removeQueueItemsForRecipient).toHaveBeenCalledWith(PEER, OWNER);
    expect(StorageService.updateGroupMessageDeliveryState).toHaveBeenCalledWith(
      OWNER,
      channelId,
      OWNER,
      EVENT_ID,
      "failed",
    );
    expect(StorageService.updateGroupMessageDeliveryState).not.toHaveBeenCalledWith(
      otherOwner,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("defers when an older owed item appears during attachment reconstruction (F5 re-scan)", async () => {
    const olderEvent = "00000000-0000-4000-8000-00000000000e";
    const currentEvent = "00000000-0000-4000-8000-00000000000f";
    const olderItem = dmQueueItem({
      id: "q-older",
      eventId: olderEvent,
      body: "older-heal",
      createdAt: NOW - 5_000,
      nextRetryAt: NOW,
    });
    const currentRaw = JSON.stringify({
      kind: CHAT_ATTACHMENT_KIND,
      event_id: currentEvent,
    });
    const currentItem = {
      id: "q-current",
      messageId: currentEvent,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: LINK_RETRY_PAYLOAD_TYPE,
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: CHAT_ATTACHMENT_KIND,
        eventId: currentEvent,
        rawJson: currentRaw,
        secretFingerprint: "fp-test",
      }),
      attempts: 1,
      nextRetryAt: NOW,
      createdAt: NOW - 1_000,
    };
    let queue = [currentItem];
    vi.mocked(RetryQueue.getDue).mockResolvedValue([currentItem]);
    vi.mocked(StorageService.listDeliveryQueue).mockImplementation(async () => queue);
    vi.mocked(StorageService.getLinkMessage).mockResolvedValue({
      deliveryState: "failed",
    } as never);
    vi.mocked(reconstructAttachmentWireJson).mockImplementation(async (raw) => {
      queue = [olderItem, currentItem];
      return raw;
    });
    sendPrivate.mockRejectedValue({ code: "protocol", message: "hard fail" });

    await LinkService.drainRetries();

    expect(reconstructAttachmentWireJson).toHaveBeenCalled();
    expect(RetryQueue.defer).toHaveBeenCalledWith("q-current", currentItem.attempts);
    expect(RetryQueue.recordFailure).not.toHaveBeenCalledWith("q-current", expect.anything());
    expect(StorageService.updateLinkMessageDeliveryState).not.toHaveBeenCalledWith(
      OWNER,
      OWNER,
      CHAT_ATTACHMENT_KIND,
      currentEvent,
      "failed",
    );
    expect(sendPrivate.mock.calls.map((call) => call[1])).not.toContain(currentRaw);
  });

  it("defers without burning attempts when the pre-encrypt re-scan throws (R6-1)", async () => {
    const item = dmQueueItem({
      id: QUEUE_ID,
      eventId: EVENT_ID,
      body: "current",
      createdAt: NOW - 1_000,
      nextRetryAt: NOW,
    });
    item.attempts = 9;
    vi.mocked(RetryQueue.getDue).mockResolvedValue([item]);
    vi.mocked(StorageService.listDeliveryQueue)
      .mockResolvedValueOnce([item])
      .mockRejectedValueOnce(new Error("SQLITE_BUSY: database is locked"));
    vi.mocked(StorageService.getLinkMessage).mockResolvedValue({
      deliveryState: "failed",
    } as never);
    sendPrivate.mockRejectedValue({ code: "protocol", message: "hard fail" });

    await LinkService.drainRetries();

    expect(RetryQueue.defer).toHaveBeenCalledWith(QUEUE_ID, 9);
    expect(RetryQueue.recordFailure).not.toHaveBeenCalled();
    expect(RetryQueue.park).not.toHaveBeenCalled();
    expect(StorageService.updateLinkMessageDeliveryState).not.toHaveBeenCalled();
    expect(sendPrivate).not.toHaveBeenCalled();
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
          });
    getMessageRequest.mockReset().mockResolvedValue(null);
    getPubky.mockReset().mockResolvedValue(OWNER);
    vi.mocked(StorageService.enqueueControlPam).mockReset();
    vi.mocked(StorageService.recordPeerChatKindsV).mockReset();
    vi.mocked(StorageService.getLinkReadCursor).mockReset().mockResolvedValue(null);
    vi.mocked(StorageService.getLinkMessagesForConversation).mockReset().mockResolvedValue([]);
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

  it("expires a delete deferred beyond its TTL", async () => {
    getLink.mockResolvedValue(establishedLink);
    vi.mocked(StorageService.countLinkMessagesForPeer).mockResolvedValue(1);
    const rawJson = JSON.stringify({
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: "11111111-1111-4111-8111-111111111111",
      sent_at: NOW,
      target_event_id: EVENT_ID,
    });
    vi.mocked(StorageService.getUnprocessedLinkStreamItems).mockResolvedValue([
      {
        id: "expired-delete",
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_DELETE_KIND,
        rawJson,
        receivedAt: NOW - 48 * 60 * 60 * 1000 - 1,
        processed: false,
      },
    ]);
    receivePrivate.mockResolvedValue({ messages: [], snapshot: "recv-1" });

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

    expect(StorageService.markLinkStreamItemProcessed).toHaveBeenCalledWith(
      "expired-delete",
    );
  });

  it("keeps a short-latency deferred delete available for its target", async () => {
    getLink.mockResolvedValue(establishedLink);
    vi.mocked(StorageService.countLinkMessagesForPeer).mockResolvedValue(1);
    const rawJson = JSON.stringify({
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: "22222222-2222-4222-8222-222222222222",
      sent_at: NOW,
      target_event_id: EVENT_ID,
    });
    vi.mocked(StorageService.getUnprocessedLinkStreamItems).mockResolvedValue([
      {
        id: "short-delete",
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_DELETE_KIND,
        rawJson,
        receivedAt: NOW,
        processed: false,
      },
    ]);
    receivePrivate.mockResolvedValue({ messages: [], snapshot: "recv-1" });

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

    expect(StorageService.markLinkStreamItemProcessed).not.toHaveBeenCalledWith(
      "short-delete",
    );
  });

  it("does not return a message tombstoned during deferred same-batch routing", async () => {
    getLink.mockResolvedValue(establishedLink);
    vi.mocked(StorageService.countLinkMessagesForPeer).mockResolvedValue(1);
    const targetEventId = "33333333-3333-4333-8333-333333333333";
    const deleteJson = JSON.stringify({
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: "44444444-4444-4444-8444-444444444444",
      sent_at: NOW,
      target_event_id: targetEventId,
    });
    const messageJson = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: targetEventId,
      sent_at: NOW,
      body: "should be tombstoned",
    });
    const target = {
      ownerPubky: OWNER,
      eventId: targetEventId,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: PEER,
      direction: "received" as const,
      kind: CHAT_MESSAGE_KIND,
      rawJson: messageJson,
      body: "should be tombstoned",
      sentAt: NOW,
      receivedAt: NOW,
      deliveryState: "delivered" as const,
    };
    const deleteItem = {
      id: "delete-before-target",
      ownerPubky: OWNER,
      peerPubky: PEER,
      kind: CHAT_DELETE_KIND,
      rawJson: deleteJson,
      receivedAt: NOW,
      processed: false,
    };
    vi.mocked(StorageService.getUnprocessedLinkStreamItems)
      .mockResolvedValueOnce([
      {
        ...deleteItem,
      },
      {
        id: "same-batch-target",
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: messageJson,
        receivedAt: NOW,
        processed: false,
      },
      ])
      .mockResolvedValueOnce([deleteItem])
      .mockResolvedValue([]);
    let targetStored = false;
    let targetTombstoned = false;
    vi.mocked(StorageService.findLinkMessageInConversation).mockImplementation(async () => {
      if (!targetStored) {
        targetStored = true;
        return null;
      }
      return targetTombstoned
        ? { ...target, body: "", rawJson: JSON.stringify({ deleted: true }) }
        : target;
    });
    vi.mocked(StorageService.saveLinkMessage).mockImplementationOnce(async () => {
      targetStored = true;
    });
    vi.mocked(StorageService.tombstoneLinkMessage).mockImplementationOnce(async () => {
      targetTombstoned = true;
      return true;
    });
    receivePrivate.mockResolvedValue({ messages: [], snapshot: "recv-1" });

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);
    expect(StorageService.tombstoneLinkMessage).toHaveBeenCalledWith({
      ownerPubky: OWNER,
      conversationId: `dm:${PEER}`,
      eventId: targetEventId,
      senderPubky: PEER,
    });
  });

  it("does not return a message tombstoned by a later delete in the same pass", async () => {
    getLink.mockResolvedValue(establishedLink);
    vi.mocked(StorageService.countLinkMessagesForPeer).mockResolvedValue(1);
    const targetEventId = "55555555-5555-4555-8555-555555555555";
    const messageJson = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: targetEventId,
      sent_at: NOW,
      body: "should not be returned",
    });
    const deleteJson = JSON.stringify({
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: "66666666-6666-4666-8666-666666666666",
      sent_at: NOW,
      target_event_id: targetEventId,
    });
    const target = {
      ownerPubky: OWNER,
      eventId: targetEventId,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: PEER,
      direction: "received" as const,
      kind: CHAT_MESSAGE_KIND,
      rawJson: messageJson,
      body: "should not be returned",
      sentAt: NOW,
      receivedAt: NOW,
      deliveryState: "delivered" as const,
    };
    vi.mocked(StorageService.getUnprocessedLinkStreamItems).mockResolvedValue([
      {
        id: "target-before-delete",
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: messageJson,
        receivedAt: NOW,
        processed: false,
      },
      {
        id: "delete-after-target",
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_DELETE_KIND,
        rawJson: deleteJson,
        receivedAt: NOW,
        processed: false,
      },
    ]);
    let tombstoned = false;
    vi.mocked(StorageService.findLinkMessageInConversation).mockImplementation(async () =>
      tombstoned ? { ...target, body: "", rawJson: JSON.stringify({ deleted: true }) } : target,
    );
    vi.mocked(StorageService.tombstoneLinkMessage).mockImplementationOnce(async () => {
      tombstoned = true;
      return true;
    });
    receivePrivate.mockResolvedValue({ messages: [], snapshot: "recv-1" });

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);
    expect(StorageService.tombstoneLinkMessage).toHaveBeenCalledWith({
      ownerPubky: OWNER,
      conversationId: `dm:${PEER}`,
      eventId: targetEventId,
      senderPubky: PEER,
    });
  });

  it("does not return plaintext when same-pass reconciliation cannot find the current row", async () => {
    getLink.mockResolvedValue(establishedLink);
    vi.mocked(StorageService.countLinkMessagesForPeer).mockResolvedValue(1);
    const targetEventId = "77777777-7777-4777-8777-777777777777";
    const messageJson = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: targetEventId,
      sent_at: NOW,
      body: "must not leak",
    });
    const deleteJson = JSON.stringify({
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: "88888888-8888-4888-8888-888888888888",
      sent_at: NOW,
      target_event_id: targetEventId,
    });
    vi.mocked(StorageService.getUnprocessedLinkStreamItems).mockResolvedValue([
      {
        id: "missing-target-message",
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: messageJson,
        receivedAt: NOW,
        processed: false,
      },
      {
        id: "missing-target-delete",
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_DELETE_KIND,
        rawJson: deleteJson,
        receivedAt: NOW,
        processed: false,
      },
    ]);
    vi.mocked(StorageService.findLinkMessageInConversation)
      .mockResolvedValueOnce({
        ownerPubky: OWNER,
        eventId: targetEventId,
        conversationId: `dm:${PEER}`,
        peerPubky: PEER,
        senderPubky: PEER,
        direction: "received",
        kind: CHAT_MESSAGE_KIND,
        rawJson: messageJson,
        body: "must not leak",
        sentAt: NOW,
        receivedAt: NOW,
        deliveryState: "delivered",
      })
      .mockResolvedValueOnce(null);
    receivePrivate.mockResolvedValue({ messages: [], snapshot: "recv-1" });

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);
  });

  it("does not return plaintext when same-pass reconciliation cannot parse the current row", async () => {
    getLink.mockResolvedValue(establishedLink);
    vi.mocked(StorageService.countLinkMessagesForPeer).mockResolvedValue(1);
    const targetEventId = "99999999-9999-4999-8999-999999999999";
    const messageJson = JSON.stringify({
      version: 1,
      kind: CHAT_MESSAGE_KIND,
      event_id: targetEventId,
      sent_at: NOW,
      body: "must not leak",
    });
    const deleteJson = JSON.stringify({
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sent_at: NOW,
      target_event_id: targetEventId,
    });
    const target = {
      ownerPubky: OWNER,
      eventId: targetEventId,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: PEER,
      direction: "received" as const,
      kind: CHAT_MESSAGE_KIND,
      rawJson: messageJson,
      body: "must not leak",
      sentAt: NOW,
      receivedAt: NOW,
      deliveryState: "delivered" as const,
    };
    vi.mocked(StorageService.getUnprocessedLinkStreamItems).mockResolvedValue([
      {
        id: "unparseable-target-message",
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        rawJson: messageJson,
        receivedAt: NOW,
        processed: false,
      },
      {
        id: "unparseable-target-delete",
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_DELETE_KIND,
        rawJson: deleteJson,
        receivedAt: NOW,
        processed: false,
      },
    ]);
    vi.mocked(StorageService.findLinkMessageInConversation)
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce({
        ...target,
        rawJson: "{not-json",
      });
    receivePrivate.mockResolvedValue({ messages: [], snapshot: "recv-1" });

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);
  });
});

describe("LinkService established re-key marker compare", () => {
  beforeEach(async () => {
    resetLinkServiceHarnessState();
    receivePrivate.mockReset().mockResolvedValue({ messages: [], snapshot: "est-old" });
    restoreLink.mockReset().mockResolvedValue({ linkId: "est-live" });
    probeInbound.mockReset().mockResolvedValue({
      result: "pending",
      linkId: "rekey-hs",
      snapshot: "rekey-snap",
    });
    getMarker.mockReset();
    getMessageRequest.mockReset().mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: "accepted",
    });
    getPubky.mockReset().mockResolvedValue(OWNER);
    getReceiver.mockReset().mockResolvedValue({
      ownerPubky: OWNER,
      receiverAlias: "recv",
      receiverPath: LINK_RECEIVER_PATH,
      markerPublished: true,
    });
    vi.mocked(StorageService.recordLastSeenPeerMarkerPk).mockReset();
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

  it("probes with the fetched marker pk when last_seen already matches GET but the established remote pk is old", async () => {
    getLink.mockResolvedValue({
      ...establishedLink,
      remoteNoisePublicKey: "old-peer-pk",
      lastSeenPeerMarkerPk: "new-peer-pk",
    });
    getMarker.mockResolvedValue({
      noisePublicKey: "new-peer-pk",
          });

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

    expect(probeInbound).toHaveBeenCalledWith(
      expect.anything(),
      "recv",
      PEER,
      "new-peer-pk",
      LINK_RECEIVER_PATH,
      LINK_RECEIVER_PATH,
    );
  });

  it("does not probe the established remote pk when a stale GET matches it and last_seen is already the new pk", async () => {
    getLink.mockResolvedValue({
      ...establishedLink,
      remoteNoisePublicKey: "old-peer-pk",
      lastSeenPeerMarkerPk: "new-peer-pk",
    });
    getMarker.mockResolvedValue({
      noisePublicKey: "old-peer-pk",
          });

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

    expect(probeInbound).not.toHaveBeenCalled();
  });

  it("probes a fetched re-key pk when last_seen differs from GET", async () => {
    getLink.mockResolvedValue({
      ...establishedLink,
      remoteNoisePublicKey: "old-peer-pk",
      lastSeenPeerMarkerPk: "stale-last-seen-pk",
    });
    getMarker.mockResolvedValue({
      noisePublicKey: "new-peer-pk",
          });

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

    expect(probeInbound).toHaveBeenCalledWith(
      expect.anything(),
      "recv",
      PEER,
      "new-peer-pk",
      LINK_RECEIVER_PATH,
      LINK_RECEIVER_PATH,
    );
    expect(probeInbound).not.toHaveBeenCalledWith(
      expect.anything(),
      "recv",
      PEER,
      "stale-last-seen-pk",
      LINK_RECEIVER_PATH,
      LINK_RECEIVER_PATH,
    );
  });

  it("logs inbound-probe result=none so a poisoned GET is visible in the web console", async () => {
    getLink.mockResolvedValue({
      ...establishedLink,
      remoteNoisePublicKey: "old-peer-pk",
      lastSeenPeerMarkerPk: "stale-last-seen-pk",
    });
    getMarker.mockResolvedValue({
      noisePublicKey: "new-peer-pk",
    });
    probeInbound.mockResolvedValue({ result: "none" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes("inbound-probe result=none")),
    ).toBe(true);
  });
});

describe("LinkService holds responder msg2 instead of re-accepting", () => {
  beforeEach(async () => {
    resetLinkServiceHarnessState();
    receivePrivate.mockReset().mockResolvedValue({ messages: [], snapshot: "recv-1" });
    restoreLink.mockReset().mockResolvedValue({ linkId: "est-resp" });
    restoreHandshake.mockReset();
    initiateLink.mockReset();
    probeInbound.mockReset().mockResolvedValue({
      result: "pending",
      linkId: "resp-1",
      snapshot: "resp-msg2",
    });
    advanceHandshake.mockReset().mockResolvedValue({
      status: "established",
      snapshot: "resp-msg3",
    });
    getMarker.mockReset().mockResolvedValue({ noisePublicKey: "peer-noise" });
    getMessageRequest.mockReset().mockResolvedValue(null);
    getPubky.mockReset().mockResolvedValue(OWNER);
    getReceiver.mockReset().mockResolvedValue({
      ownerPubky: OWNER,
      receiverAlias: "recv",
      receiverPath: LINK_RECEIVER_PATH,
      markerPublished: true,
    });
    getLink.mockReset().mockResolvedValue(null);
    vi.mocked(StorageService.getHandshakeBudget).mockReset().mockResolvedValue(null);
    vi.mocked(StorageService.getContact).mockReset().mockResolvedValue(null);
    vi.mocked(StorageService.getUnprocessedLinkStreamItems).mockReset().mockResolvedValue([]);
    vi.mocked(StorageService.countLinkMessagesForPeer).mockReset().mockResolvedValue(0);
    vi.mocked(StorageService.upsertMessageRequest).mockReset();
    vi.mocked(StorageService.deleteLink).mockReset();
    vi.mocked(StorageService.upsertLink).mockReset();
    vi.mocked(RetryQueue.getDue).mockReset().mockResolvedValue([]);
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    await LinkService.adoptHarnessSession(handle() as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetLinkServiceHarnessState();
  });

  it("advances a pending responder handshake instead of accepting again", async () => {
    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("handshaking-responder");
    probeInbound.mockClear();
    getLink.mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "responder",
      status: "handshaking",
      snapshot: "resp-msg2",
      remoteNoisePublicKey: "peer-noise",
      localReceiverPath: LINK_RECEIVER_PATH,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
      lastSeenPeerMarkerPk: "peer-noise",
      updatedAt: NOW,
    });

    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("ready");

    expect(probeInbound).not.toHaveBeenCalled();
    expect(advanceHandshake).toHaveBeenCalledWith("resp-1");
    expect(initiateLink).not.toHaveBeenCalled();
  });

  it("does not re-accept a young stored responder handshake on inbox poll", async () => {
    getLink.mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "responder",
      status: "handshaking",
      snapshot: "old-channel",
      remoteNoisePublicKey: "peer-noise",
      localReceiverPath: LINK_RECEIVER_PATH,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
      lastSeenPeerMarkerPk: "peer-noise",
      updatedAt: NOW,
    });
    restoreHandshake.mockResolvedValue({ linkId: "hs-old", status: "pending" });
    probeInbound.mockResolvedValue({
      result: "pending",
      linkId: "fresh-hs",
      snapshot: "new-channel",
    });

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

    expect(probeInbound).not.toHaveBeenCalled();
    expect(restoreHandshake).toHaveBeenCalled();
    expect(advanceHandshake).toHaveBeenCalledWith("hs-old");
    expect(StorageService.deleteLink).not.toHaveBeenCalled();
  });

  it("wipes and re-accepts when the peer re-enrolls a new marker pk while responder-pending", async () => {
    getLink.mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "responder",
      status: "handshaking",
      snapshot: "resp-msg2",
      remoteNoisePublicKey: "peer-noise",
      localReceiverPath: LINK_RECEIVER_PATH,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
      lastSeenPeerMarkerPk: "peer-noise",
      updatedAt: NOW,
    });
    getMarker.mockResolvedValue({ noisePublicKey: "re-enrolled-noise-pk" });
    probeInbound.mockResolvedValue({
      result: "established",
      linkId: "fresh-est",
      snapshot: "est-rekey",
    });

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

    expect(StorageService.deleteLink).toHaveBeenCalledWith(OWNER, PEER);
    expect(probeInbound).toHaveBeenCalled();
    expect(advanceHandshake).not.toHaveBeenCalled();
    expect(StorageService.upsertLink).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "responder",
        status: "established",
        remoteNoisePublicKey: "re-enrolled-noise-pk",
        snapshot: "est-rekey",
      }),
    );
  });
});

describe("LinkService parked established re-key on ensureLink", () => {
  beforeEach(async () => {
    resetLinkServiceHarnessState();
    receivePrivate.mockReset().mockResolvedValue({ messages: [], snapshot: "est-old" });
    restoreLink.mockReset().mockResolvedValue({ linkId: "est-live" });
    initiateLink.mockReset();
    probeInbound.mockReset().mockResolvedValue({
      result: "pending",
      linkId: "rekey-hs",
      snapshot: "rekey-snap",
    });
    advanceHandshake.mockReset().mockResolvedValue({
      status: "pending",
      snapshot: "rekey-snap",
    });
    sendPrivate.mockReset();
    persistIntent.mockReset().mockResolvedValue(undefined);
    finalizeSend.mockReset().mockResolvedValue(undefined);
    getMarker.mockReset().mockResolvedValue({
      noisePublicKey: "new-peer-pk",
          });
    getMessageRequest.mockReset().mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: "accepted",
    });
    getPubky.mockReset().mockResolvedValue(OWNER);
    getReceiver.mockReset().mockResolvedValue({
      ownerPubky: OWNER,
      receiverAlias: "recv",
      receiverPath: LINK_RECEIVER_PATH,
      markerPublished: true,
    });
    let lastSeenPeerMarkerPk = "old-peer-pk";
    getLink.mockReset().mockImplementation(async () => ({
      ...establishedLink,
      remoteNoisePublicKey: "old-peer-pk",
      lastSeenPeerMarkerPk,
    }));
    vi.mocked(StorageService.recordLastSeenPeerMarkerPk).mockReset().mockImplementation(
      async (_owner, _peer, pk) => {
        lastSeenPeerMarkerPk = pk;
      },
    );
    vi.mocked(StorageService.getUnprocessedLinkStreamItems).mockReset().mockResolvedValue([]);
    vi.mocked(StorageService.upsertArchivedLink).mockReset();
    vi.mocked(StorageService.upsertLink).mockReset();
    vi.mocked(RetryQueue.getDue).mockReset().mockResolvedValue([]);
    vi.mocked(isRetired).mockReset().mockReturnValue(false);
    vi.mocked(StorageService.listDeliveryQueue).mockReset().mockResolvedValue([]);
    vi.mocked(StorageService.listOwedOutboundLinkMessages).mockReset().mockResolvedValue([]);
    vi.mocked(StorageService.getLinkMessage).mockReset().mockResolvedValue({
      ownerPubky: OWNER,
      senderPubky: OWNER,
      kind: CHAT_MESSAGE_KIND,
      eventId: EVENT_ID,
      deliveryState: "sending",
    } as never);
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(EVENT_ID).mockReturnValue(QUEUE_ID);
    await LinkService.adoptHarnessSession(handle() as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetLinkServiceHarnessState();
  });

  it("does not return ready or encrypt on the old handle while a re-key is parked", async () => {
    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("handshaking-responder");
    const queued = await LinkService.sendDm(PEER, "hello");
    expect(queued.deliveryState).toBe("sending");
    expect(sendPrivate).not.toHaveBeenCalled();
    expect(StorageService.upsertArchivedLink).not.toHaveBeenCalled();
  });

  it("flushes a queued DM once on the new handle after a parked re-key establishes", async () => {
    const queued = await LinkService.sendDm(PEER, "hello");
    expect(queued.deliveryState).toBe("sending");
    expect(sendPrivate).not.toHaveBeenCalled();
    const persist = persistIntent.mock.calls[0]?.[0] as { queueItem: { payload: string } };

    advanceHandshake.mockResolvedValue({
      status: "established",
      snapshot: "rekey-est",
    });
    vi.mocked(RetryQueue.getDue).mockResolvedValueOnce([
      {
        id: QUEUE_ID,
        messageId: EVENT_ID,
        recipientPubky: PEER,
        payload: persist.queueItem.payload,
        attempts: 0,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    ]);
    sendPrivate.mockResolvedValue({ snapshot: "est-new-sent" });

    await LinkService.drainRetries();

    expect(sendPrivate).toHaveBeenCalledTimes(1);
    expect(sendPrivate).toHaveBeenCalledWith("rekey-hs", expect.any(String));
    expect(StorageService.upsertArchivedLink).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: "HC1.opaque", remoteNoisePublicKey: "old-peer-pk" }),
    );
  });

  it("does not start a GET-only initiator handshake over an established predecessor", async () => {
    probeInbound.mockResolvedValue({ result: "none" });
    let lastSeen = "old-peer-pk";
    getLink.mockImplementation(async () => ({
      ...establishedLink,
      role: "initiator",
      remoteNoisePublicKey: "old-peer-pk",
      lastSeenPeerMarkerPk: lastSeen,
    }));
    vi.mocked(StorageService.recordLastSeenPeerMarkerPk).mockImplementation(async (_o, _p, pk) => {
      lastSeen = pk;
    });

    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("error");
    expect(initiateLink).not.toHaveBeenCalled();
    expect(sendPrivate).not.toHaveBeenCalled();

    const queued = await LinkService.sendDm(PEER, "hello");
    expect(queued.deliveryState).toBe("sending");
    expect(persistIntent).toHaveBeenCalled();
    expect(sendPrivate).not.toHaveBeenCalled();
    await expect(LinkService.getLinkStatus(PEER)).resolves.toBe("error");
  });

  it("converges three successive established re-key cycles onto the newest link", async () => {
    let link: typeof establishedLink & { lastSeenPeerMarkerPk: string } = {
      ...establishedLink,
      remoteNoisePublicKey: "peer-pk-0",
      lastSeenPeerMarkerPk: "peer-pk-0",
      snapshot: "est-0",
    };
    getLink.mockImplementation(async () => link);
    vi.mocked(StorageService.upsertLink).mockImplementation(async (record) => {
      link = {
        ...establishedLink,
        ...record,
        lastSeenPeerMarkerPk: record.lastSeenPeerMarkerPk ?? link.lastSeenPeerMarkerPk,
        role: "responder",
        status: "established",
      };
    });

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      vi.spyOn(Date, "now").mockReturnValue(NOW + cycle * (PEER_MARKER_REFRESH_TTL_MS + 1));
      const newPk = `peer-pk-${cycle}`;
      getMarker.mockResolvedValue({ noisePublicKey: newPk });
      probeInbound.mockResolvedValue({
        result: "pending",
        linkId: `rekey-hs-${cycle}`,
        snapshot: `rekey-snap-${cycle}`,
      });
      advanceHandshake.mockResolvedValue({
        status: "pending",
        snapshot: `rekey-snap-${cycle}`,
      });
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("handshaking-responder");
      advanceHandshake.mockResolvedValue({
        status: "established",
        snapshot: `rekey-est-${cycle}`,
      });
      await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("ready");
      expect(link.remoteNoisePublicKey).toBe(newPk);
      expect(link.status).toBe("established");
    }
  });

  function installDurableBudget() {
    let row: {
      pendingAdvances: number;
      nextAdvanceAt: number;
      exhaustedAt: number | null;
    } = { pendingAdvances: 0, nextAdvanceAt: 0, exhaustedAt: null };
    vi.mocked(StorageService.getHandshakeBudget).mockImplementation(async () => {
      if (row.pendingAdvances === 0 && row.nextAdvanceAt === 0 && row.exhaustedAt === null) {
        return null;
      }
      return {
        ownerPubky: OWNER,
        peerPubky: PEER,
        pendingAdvances: row.pendingAdvances,
        nextAdvanceAt: row.nextAdvanceAt,
        exhaustedAt: row.exhaustedAt,
        updatedAt: NOW,
      };
    });
    vi.mocked(StorageService.upsertHandshakeBudget).mockImplementation(async (budget) => {
      row = {
        pendingAdvances: budget.pendingAdvances,
        nextAdvanceAt: budget.nextAdvanceAt,
        exhaustedAt: budget.exhaustedAt,
      };
    });
    vi.mocked(StorageService.clearHandshakeBudget).mockImplementation(async () => {
      row = { pendingAdvances: 0, nextAdvanceAt: 0, exhaustedAt: null };
    });
    return {
      set(next: Partial<typeof row>) {
        row = { ...row, ...next };
      },
    };
  }

  it("does not return ready or encrypt on the old handle after the handshake budget is exhausted", async () => {
    const budget = installDurableBudget();
    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("handshaking-responder");
    const queued = await LinkService.sendDm(PEER, "hello");
    expect(queued.deliveryState).toBe("sending");
    expect(sendPrivate).not.toHaveBeenCalled();

    budget.set({
      pendingAdvances: HANDSHAKE_PENDING_ADVANCE_LIMIT - 1,
      nextAdvanceAt: 0,
      exhaustedAt: null,
    });
    await LinkService.syncInbox([PEER]);
    sendPrivate.mockClear();
    vi.mocked(RetryQueue.getDue).mockResolvedValue([
      {
        id: QUEUE_ID,
        messageId: EVENT_ID,
        recipientPubky: PEER,
        payload: JSON.stringify({
          type: LINK_RETRY_PAYLOAD_TYPE,
          ownerPubky: OWNER,
          peerPubky: PEER,
          senderPubky: OWNER,
          kind: CHAT_MESSAGE_KIND,
          eventId: EVENT_ID,
          rawJson: "{}",
        }),
        attempts: 0,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    ]);

    await LinkService.drainRetries();
    expect(sendPrivate).not.toHaveBeenCalled();

    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("handshaking-responder");
  });

  it("caps established re-key parks per stale window until user intent", async () => {
    installDurableBudget();
    for (let cycle = 0; cycle < ESTABLISHED_REKEY_PARK_LIMIT; cycle += 1) {
      vi.spyOn(Date, "now").mockReturnValue(NOW + cycle * (PEER_MARKER_REFRESH_TTL_MS + 1));
      probeInbound.mockResolvedValue({
        result: "pending",
        linkId: `rekey-hs-${cycle}`,
        snapshot: `rekey-snap-${cycle}`,
      });
      advanceHandshake.mockRejectedValueOnce(new Error("transient"));
      await LinkService.syncInbox([PEER]);
    }
    vi.spyOn(Date, "now").mockReturnValue(
      NOW + ESTABLISHED_REKEY_PARK_LIMIT * (PEER_MARKER_REFRESH_TTL_MS + 1),
    );
    probeInbound.mockClear();
    probeInbound.mockResolvedValue({
      result: "pending",
      linkId: "rekey-hs-blocked",
      snapshot: "rekey-snap-blocked",
    });
    await LinkService.syncInbox([PEER]);
    expect(probeInbound).not.toHaveBeenCalled();

    advanceHandshake.mockReset().mockResolvedValue({
      status: "pending",
      snapshot: "rekey-snap-user",
    });
    probeInbound.mockResolvedValue({
      result: "pending",
      linkId: "rekey-hs-user",
      snapshot: "rekey-snap-user",
    });
    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("handshaking-responder");
    expect(probeInbound).toHaveBeenCalled();
  });

  it("queues a send while the re-key is blocked and flushes once after user retry", async () => {
    installDurableBudget();
    let lastSeen = "new-peer-pk";
    let link: typeof establishedLink & { lastSeenPeerMarkerPk: string } = {
      ...establishedLink,
      remoteNoisePublicKey: "old-peer-pk",
      lastSeenPeerMarkerPk: lastSeen,
    };
    getLink.mockImplementation(async () => ({ ...link, lastSeenPeerMarkerPk: lastSeen }));
    vi.mocked(StorageService.upsertLink).mockImplementation(async (record) => {
      link = {
        ...establishedLink,
        ...record,
        lastSeenPeerMarkerPk: lastSeen,
        role: "responder",
        status: "established",
      };
    });
    vi.mocked(StorageService.recordLastSeenPeerMarkerPk).mockImplementation(async (_o, _p, pk) => {
      lastSeen = pk;
    });

    for (let cycle = 0; cycle < ESTABLISHED_REKEY_PARK_LIMIT; cycle += 1) {
      vi.spyOn(Date, "now").mockReturnValue(NOW + cycle * (PEER_MARKER_REFRESH_TTL_MS + 1));
      probeInbound.mockResolvedValue({
        result: "pending",
        linkId: `rekey-hs-${cycle}`,
        snapshot: `rekey-snap-${cycle}`,
      });
      advanceHandshake.mockRejectedValueOnce(new Error("transient"));
      await LinkService.syncInbox([PEER]);
    }
    vi.spyOn(Date, "now").mockReturnValue(
      NOW + ESTABLISHED_REKEY_PARK_LIMIT * (PEER_MARKER_REFRESH_TTL_MS + 1),
    );
    probeInbound.mockClear();
    await LinkService.syncInbox([PEER]);
    await expect(LinkService.getLinkStatus(PEER)).resolves.toBe("error");

    probeInbound.mockResolvedValue({
      result: "pending",
      linkId: "rekey-hs-user",
      snapshot: "rekey-snap-user",
    });
    advanceHandshake.mockReset().mockResolvedValue({
      status: "pending",
      snapshot: "rekey-snap-user",
    });
    sendPrivate.mockResolvedValue({ snapshot: "should-not-send" });
    const queued = await LinkService.sendDm(PEER, "hello");
    expect(queued.deliveryState).toBe("sending");
    expect(persistIntent).toHaveBeenCalled();
    expect(sendPrivate).not.toHaveBeenCalled();
    const persist = persistIntent.mock.calls[0]?.[0] as { queueItem: { payload: string } };

    advanceHandshake.mockResolvedValue({
      status: "established",
      snapshot: "rekey-est",
    });
    sendPrivate.mockResolvedValue({ snapshot: "est-new-sent" });
    vi.mocked(RetryQueue.getDue).mockResolvedValue([
      {
        id: QUEUE_ID,
        messageId: EVENT_ID,
        recipientPubky: PEER,
        payload: persist.queueItem.payload,
        attempts: 0,
        nextRetryAt: NOW,
        createdAt: NOW,
      },
    ]);
    await LinkService.retryPeerSends(PEER);
    expect(StorageService.clearHandshakeBudget).toHaveBeenCalled();
    expect(probeInbound).toHaveBeenCalled();
    expect(sendPrivate).toHaveBeenCalledTimes(1);
  });

  it("does not return ready after a stale parked re-key is dropped against a new marker", async () => {
    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("handshaking-responder");
    vi.spyOn(Date, "now").mockReturnValue(NOW + HANDSHAKE_STALE_MS);
    sendPrivate.mockClear();
    await LinkService.syncInbox([PEER]);
    expect(sendPrivate).not.toHaveBeenCalled();
    await expect(LinkService.ensureLinkWith(PEER)).resolves.not.toBe("ready");
  });

  describe("chat_kinds_v advertisement", () => {
    const conversationId = `dm:${PEER}`;

    function v1Marker() {
      return {
        noisePublicKey: "peer-noise",
              };
    }

    it("does not emit chat.receipt.v0 to a pre-v1 peer", async () => {
      getLink.mockResolvedValue({
        ownerPubky: OWNER,
        peerPubky: PEER,
        role: "initiator",
        status: "established",
        snapshot: "HC1.opaque",
        remoteNoisePublicKey: "peer-noise",
        localReceiverPath: LINK_RECEIVER_PATH,
        remoteReceiverPath: LINK_RECEIVER_PATH,
        consecutiveFailures: 0,
        chatKindsV: 0,
        updatedAt: NOW,
      });
      vi.mocked(StorageService.getLinkMessagesForConversation).mockResolvedValue([
        {
          ownerPubky: OWNER,
          eventId: EVENT_ID,
          conversationId,
          peerPubky: PEER,
          senderPubky: PEER,
          direction: "received",
          kind: CHAT_MESSAGE_KIND,
          rawJson: "{}",
          body: "hi",
          sentAt: NOW,
          receivedAt: NOW,
          deliveryState: "delivered",
        },
      ]);

      await LinkService.markRead(conversationId, NOW);

      expect(StorageService.enqueueControlPam).not.toHaveBeenCalled();
    });

    it("emits chat.receipt.v0 after the peer marker shows v1", async () => {
      getLink.mockResolvedValue({
        ownerPubky: OWNER,
        peerPubky: PEER,
        role: "initiator",
        status: "established",
        snapshot: "HC1.opaque",
        remoteNoisePublicKey: "peer-noise",
        localReceiverPath: LINK_RECEIVER_PATH,
        remoteReceiverPath: LINK_RECEIVER_PATH,
        consecutiveFailures: 0,
        chatKindsV: 1,
        updatedAt: NOW,
      });
      vi.mocked(StorageService.getLinkMessagesForConversation).mockResolvedValue([
        {
          ownerPubky: OWNER,
          eventId: EVENT_ID,
          conversationId,
          peerPubky: PEER,
          senderPubky: PEER,
          direction: "received",
          kind: CHAT_MESSAGE_KIND,
          rawJson: "{}",
          body: "hi",
          sentAt: NOW,
          receivedAt: NOW,
          deliveryState: "delivered",
        },
      ]);

      await LinkService.markRead(conversationId, NOW);

      expect(StorageService.enqueueControlPam).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientPubky: PEER,
          payload: expect.stringContaining(CHAT_RECEIPT_KIND),
        }),
      );
    });

    it("persists chat_kinds_v from a fetched peer marker", async () => {
      getMarker.mockResolvedValue(v1Marker());
      getLink.mockResolvedValue({
        ownerPubky: OWNER,
        peerPubky: PEER,
        role: "initiator",
        status: "established",
        snapshot: "HC1.opaque",
        remoteNoisePublicKey: "peer-noise",
        localReceiverPath: LINK_RECEIVER_PATH,
        remoteReceiverPath: LINK_RECEIVER_PATH,
        consecutiveFailures: 0,
        chatKindsV: 0,
        updatedAt: NOW,
      });

      await LinkService.ensureLinkWith(PEER);

      expect(StorageService.recordPeerChatKindsV).toHaveBeenCalledWith(OWNER, PEER, 1);
    });

    it("replays read receipts once when chat_kinds_v flips 0 to 1", async () => {
      getMarker.mockResolvedValue(v1Marker());
      getLink.mockResolvedValue({
        ownerPubky: OWNER,
        peerPubky: PEER,
        role: "initiator",
        status: "established",
        snapshot: "HC1.opaque",
        remoteNoisePublicKey: "peer-noise",
        localReceiverPath: LINK_RECEIVER_PATH,
        remoteReceiverPath: LINK_RECEIVER_PATH,
        consecutiveFailures: 0,
        chatKindsV: 0,
        updatedAt: NOW,
      });
      vi.mocked(StorageService.getLinkReadCursor).mockResolvedValue(NOW);
      vi.mocked(StorageService.getLinkMessagesForConversation).mockResolvedValue([
        {
          ownerPubky: OWNER,
          eventId: EVENT_ID,
          conversationId,
          peerPubky: PEER,
          senderPubky: PEER,
          direction: "received",
          kind: CHAT_MESSAGE_KIND,
          rawJson: "{}",
          body: "hi",
          sentAt: NOW,
          receivedAt: NOW,
          deliveryState: "delivered",
        },
      ]);

      await LinkService.ensureLinkWith(PEER);
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });

      expect(StorageService.enqueueControlPam).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientPubky: PEER,
          payload: expect.stringContaining(CHAT_RECEIPT_KIND),
        }),
      );

      vi.mocked(StorageService.enqueueControlPam).mockClear();
      await LinkService.ensureLinkWith(PEER);
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });
      expect(StorageService.enqueueControlPam).not.toHaveBeenCalled();
    });

    it("does not replay read receipts when the device receipts pref is off", async () => {
      getMarker.mockResolvedValue(v1Marker());
      getLink.mockResolvedValue({
        ownerPubky: OWNER,
        peerPubky: PEER,
        role: "initiator",
        status: "established",
        snapshot: "HC1.opaque",
        remoteNoisePublicKey: "peer-noise",
        localReceiverPath: LINK_RECEIVER_PATH,
        remoteReceiverPath: LINK_RECEIVER_PATH,
        consecutiveFailures: 0,
        chatKindsV: 0,
        updatedAt: NOW,
      });
      vi.mocked(StorageService.ensureChatDevicePrefs).mockResolvedValue({
        ownerPubky: OWNER,
        receiptsEnabled: false,
        typingEnabled: true,
        upgradeAt: 1,
        updatedAt: 1,
      });
      vi.mocked(StorageService.getLinkReadCursor).mockResolvedValue(NOW);
      vi.mocked(StorageService.getLinkMessagesForConversation).mockResolvedValue([
        {
          ownerPubky: OWNER,
          eventId: EVENT_ID,
          conversationId,
          peerPubky: PEER,
          senderPubky: PEER,
          direction: "received",
          kind: CHAT_MESSAGE_KIND,
          rawJson: "{}",
          body: "hi",
          sentAt: NOW,
          receivedAt: NOW,
          deliveryState: "delivered",
        },
      ]);

      await LinkService.ensureLinkWith(PEER);
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });

      expect(StorageService.enqueueControlPam).not.toHaveBeenCalled();
    });

    it("does not replay read receipts to a declined peer", async () => {
      getMarker.mockResolvedValue(v1Marker());
      getLink.mockResolvedValue({
        ownerPubky: OWNER,
        peerPubky: PEER,
        role: "initiator",
        status: "established",
        snapshot: "HC1.opaque",
        remoteNoisePublicKey: "peer-noise",
        localReceiverPath: LINK_RECEIVER_PATH,
        remoteReceiverPath: LINK_RECEIVER_PATH,
        consecutiveFailures: 0,
        chatKindsV: 0,
        updatedAt: NOW,
      });
      getMessageRequest.mockResolvedValue({
        ownerPubky: OWNER,
        peerPubky: PEER,
        createdAt: NOW,
        updatedAt: NOW,
        status: "declined",
      });
      vi.mocked(StorageService.getLinkReadCursor).mockResolvedValue(NOW);
      vi.mocked(StorageService.getLinkMessagesForConversation).mockResolvedValue([
        {
          ownerPubky: OWNER,
          eventId: EVENT_ID,
          conversationId,
          peerPubky: PEER,
          senderPubky: PEER,
          direction: "received",
          kind: CHAT_MESSAGE_KIND,
          rawJson: "{}",
          body: "hi",
          sentAt: NOW,
          receivedAt: NOW,
          deliveryState: "delivered",
        },
      ]);

      await LinkService.ensureLinkWith(PEER);
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });

      expect(StorageService.enqueueControlPam).not.toHaveBeenCalled();
    });

    it("resolves inbox sync with a v1 peer and queues a delivered receipt", async () => {
      const inboundId = "11111111-1111-4111-8111-111111111111";
      const rawJson = JSON.stringify({
        version: 1,
        kind: CHAT_MESSAGE_KIND,
        event_id: inboundId,
        sent_at: NOW,
        body: "hello",
      });
      getMarker.mockResolvedValue({
        noisePublicKey: "peer-noise",
              });
      probeInbound.mockResolvedValue({ result: "none" });
      restoreLink.mockResolvedValue({ linkId: "handle-1" });
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
        lastSeenPeerMarkerPk: "peer-noise",
        chatKindsV: 1,
        updatedAt: NOW,
      });
      vi.mocked(StorageService.enqueueControlPam).mockReset();
      vi.mocked(StorageService.ensureChatDevicePrefs).mockResolvedValue({
        ownerPubky: OWNER,
        receiptsEnabled: true,
        typingEnabled: true,
        upgradeAt: 1,
        updatedAt: 1,
      });
      vi.mocked(StorageService.countLinkMessagesForPeer).mockResolvedValue(1);
      vi.mocked(StorageService.getUnprocessedLinkStreamItems).mockResolvedValue([
        {
          id: "stream-1",
          ownerPubky: OWNER,
          peerPubky: PEER,
          kind: CHAT_MESSAGE_KIND,
          rawJson,
          receivedAt: NOW,
          processed: false,
        },
      ]);
      receivePrivate.mockResolvedValue({ messages: [], snapshot: "recv-v1" });

      const received = await Promise.race([
        LinkService.syncInbox([PEER]),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("syncInbox re-entered withQueue")), 1000);
        }),
      ]);

      expect(Array.isArray(received)).toBe(true);
      expect(StorageService.enqueueControlPam).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientPubky: PEER,
          payload: expect.stringContaining(CHAT_RECEIPT_KIND),
        }),
      );
    });
  });
});
