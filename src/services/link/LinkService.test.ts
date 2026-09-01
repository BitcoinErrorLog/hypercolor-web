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
  resetLinkServiceHarnessState,
} from "./LinkService";
import { CHAT_MESSAGE_KIND, LINK_RECEIVER_PATH } from "../../types/link";

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
    vi.mocked(RetryQueue.recordSuccess).mockReset();
    vi.mocked(isRetired).mockReset().mockReturnValue(false);
    vi.mocked(StorageService.updateGroupMessageDeliveryState).mockReset();
    vi.mocked(StorageService.updateLinkMessageDeliveryState).mockReset();
    vi.mocked(StorageService.getLinkMessage).mockReset();
    vi.mocked(StorageService.getGroupMessage).mockReset();
    vi.mocked(StorageService.listDeliveryQueue).mockReset().mockResolvedValue([]);
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
    vi.mocked(StorageService.listDeliveryQueue).mockResolvedValue([owedItem]);
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
