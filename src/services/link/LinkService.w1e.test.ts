import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const restoreLink = vi.fn();
const initiateLink = vi.fn();
const probeInbound = vi.fn();
const advanceHandshake = vi.fn();
const restoreHandshake = vi.fn();
const getMarker = vi.fn();
const getLink = vi.fn();
const getReceiver = vi.fn();
const getPubky = vi.fn();
const getBudget = vi.fn();
const upsertBudget = vi.fn();
const clearBudget = vi.fn();
const deleteLink = vi.fn();
const upsertLink = vi.fn();
const closeLink = vi.fn();
const clearOutbox = vi.fn();
const deletePublic = vi.fn();
const receivePrivate = vi.fn(
  async (): Promise<{ messages: { kind: string | null; rawJson: string }[]; snapshot: string }> => ({
    messages: [],
    snapshot: "est",
  }),
);
const upsertArchivedLink = vi.fn();
const getArchivedLink = vi.fn();
const applyKnownChatKind = vi.fn();
const replayDeferredChatTags = vi.fn();

vi.mock("./PaykitLinkWeb", async () => {
  const actual = await vi.importActual<typeof import("./PaykitLinkWeb")>("./PaykitLinkWeb");
  return {
    ...actual,
    PaykitLinkWeb: {
      isAvailable: () => true,
      getReceiverMarker: (...args: unknown[]) => getMarker(...args),
      initiateLink: (...args: unknown[]) => initiateLink(...args),
      probeInboundLink: (...args: unknown[]) => probeInbound(...args),
      advanceHandshake: (...args: unknown[]) => advanceHandshake(...args),
      restoreHandshake: (...args: unknown[]) => restoreHandshake(...args),
      restoreLink: (...args: unknown[]) => restoreLink(...args),
      sendPrivateMessageJson: vi.fn(),
      receivePrivateMessages: () => receivePrivate(),
      clearLinkOutbox: (...args: unknown[]) => clearOutbox(...args),
      deletePublic: (...args: unknown[]) => deletePublic(...args),
      closeLink: (...args: unknown[]) => closeLink(...args),
    },
  };
});

vi.mock("@/services/StorageService", () => ({
  StorageService: {
    retryPendingCleanup: vi.fn(async () => undefined),
    getLinkReceiver: (...args: unknown[]) => getReceiver(...args),
    getHandshakeBudget: (...args: unknown[]) => getBudget(...args),
    upsertHandshakeBudget: (...args: unknown[]) => upsertBudget(...args),
    clearHandshakeBudget: (...args: unknown[]) => clearBudget(...args),
    getLink: (...args: unknown[]) => getLink(...args),
    getAllLinks: vi.fn(async () => []),
    upsertLink: (...args: unknown[]) => upsertLink(...args),
    upsertArchivedLink: (...args: unknown[]) => upsertArchivedLink(...args),
    getArchivedLink: (...args: unknown[]) => getArchivedLink(...args),
    deleteArchivedLink: vi.fn(async () => undefined),
    recordLastSeenPeerMarkerPk: vi.fn(),
    recordPeerChatKindsV: vi.fn(),
    getLinkReadCursor: vi.fn(async () => null),
    getLinkMessagesForConversation: vi.fn(async () => []),
    ensureChatDevicePrefs: vi.fn(async () => ({
      receiptsEnabled: true,
      typingEnabled: true,
      upgradeAt: 1,
      updatedAt: 1,
    })),
    enqueueControlPam: vi.fn(),
    updateLinkSnapshot: vi.fn(),
    markLinkReconnectRequired: vi.fn(),
    incrementLinkConsecutiveFailures: vi.fn(),
    resetLinkConsecutiveFailures: vi.fn(),
    deleteLink: (...args: unknown[]) => deleteLink(...args),
    persistLinkSendIntent: vi.fn(),
    finalizeLinkSend: vi.fn(),
    listDeliveryQueue: vi.fn(async () => []),
    getDeliveryQueueItem: vi.fn(async () => null),
    listOwedOutboundLinkMessages: vi.fn(async () => []),
    abandonOwedLinkMessagesForPeer: vi.fn(),
    enqueue: vi.fn(),
    hasQueueItemForMessage: vi.fn(async () => false),
    getLinkMessageByEventId: vi.fn(),
    getMessageRequest: vi.fn(async () => null),
    upsertMessageRequest: vi.fn(),
    getContact: vi.fn(async () => null),
    getAllContacts: vi.fn(async () => []),
    countLinkMessagesForPeer: vi.fn(async () => 0),
    getUnprocessedLinkStreamItems: vi.fn(async () => []),
    saveLinkStreamItems: vi.fn(),
    markLinkStreamItemProcessed: vi.fn(),
    markLinkStreamItemProcessedWithError: vi.fn(),
    saveLinkMessage: vi.fn(),
    hasLinkMessage: vi.fn(async () => false),
    getLinkMessage: vi.fn(),
    listPaymentRequestsWithPendingEvent: vi.fn(async () => []),
    hasGroupMessage: vi.fn(async () => true),
    countDeliveryQueueForMessage: vi.fn(async () => 0),
    updateGroupMessageDeliveryState: vi.fn(),
    updateLinkMessageDeliveryState: vi.fn(),
    updateAttachmentDelivery: vi.fn(),
    markGroupEventSeen: vi.fn(),
    clearAccountData: vi.fn(),
    removeFromQueue: vi.fn(),
    removeQueueItemsForRecipient: vi.fn(),
    removeQueueItemsAndAbandonOwedForPeer: vi.fn(),
    deleteLinkStreamItemsForPeer: vi.fn(),
    deleteLinkMessagesForPeer: vi.fn(),
    listPendingChatTags: vi.fn(async () => []),
    deletePendingChatTag: vi.fn(),
  },
}));

vi.mock("../chat/applyChatInbound", () => ({
  applyKnownChatKind: (...args: unknown[]) => applyKnownChatKind(...args),
  replayDeferredChatTags: (...args: unknown[]) => replayDeferredChatTags(...args),
}));

vi.mock("@/services/KeyStore", () => ({
  KeyStore: {
    getPubky: (...args: unknown[]) => getPubky(...args),
    setPubky: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("@/services/RetryQueue", () => ({
  RetryQueue: {
    getDue: vi.fn(async () => []),
    recordFailure: vi.fn(),
    defer: vi.fn(),
    park: vi.fn(),
    recordSuccess: vi.fn(),
    nextAttemptAt: (n: number) => Date.now() + n,
  },
  isRetired: vi.fn(() => false),
  nextAttemptAt: (n: number) => Date.now() + n,
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

vi.mock("../group/applyGroupInbound", () => ({ applyGroupInbound: vi.fn() }));
vi.mock("../attachments/applyAttachmentInbound", () => ({ applyAttachmentInbound: vi.fn() }));
vi.mock("../payments/applyPaymentInbound", () => ({ applyPaymentInbound: vi.fn() }));
vi.mock("../attachments/redaction", () => ({
  reconstructAttachmentWireJson: vi.fn(async (raw: string) => raw),
  fingerprintStoredAttachmentSecret: vi.fn(async () => "fp"),
}));
vi.mock("./provisionReceiver", () => ({
  drainReceiverPublishRetry: vi.fn(async () => false),
  provisionReceiver: vi.fn(),
  syncOwnReceiverRole: vi.fn(),
  takeoverReceiver: vi.fn(),
}));

import { HANDSHAKE_STALE_MS, LinkService, PEER_MARKER_REFRESH_TTL_MS, resetLinkServiceHarnessState } from "./LinkService";
import { LinkSendError } from "./LinkSendError";
import { createLinkNativeError } from "./PaykitLinkWeb";
import { CHAT_MESSAGE_KIND, CHAT_TAG_KIND, LINK_RECEIVER_PATH } from "../../types/link";
import { RetryQueue } from "@/services/RetryQueue";
import { StorageService } from "@/services/StorageService";
import { takeoverReceiver } from "./provisionReceiver";

const OWNER = "a".repeat(52);
const PEER = "z".repeat(52);
const NOW = 1_700_000_000_000;
const EVENT_ID = "11111111-1111-4111-8111-111111111111";

function handle() {
  return { pubky: () => OWNER, free: vi.fn() };
}

function receiver() {
  return {
    ownerPubky: OWNER,
    receiverAlias: "recv",
    receiverPath: LINK_RECEIVER_PATH,
    markerPublished: true,
    receiverRole: "active" as const,
    lastSeenOwnMarkerPk: "local-pk",
    updatedAt: NOW,
  };
}

function handshaking(remote = "old-pk") {
  return {
    ownerPubky: OWNER,
    peerPubky: PEER,
    role: "initiator" as const,
    status: "handshaking" as const,
    snapshot: "snap-1",
    remoteNoisePublicKey: remote,
    localReceiverPath: LINK_RECEIVER_PATH,
    remoteReceiverPath: LINK_RECEIVER_PATH,
    consecutiveFailures: 0,
    lastSeenPeerMarkerPk: remote,
    updatedAt: NOW,
  };
}

type HarnessLinkRow = Omit<ReturnType<typeof handshaking>, "status"> & {
  status: "handshaking" | "established" | "reconnect_required";
};

describe("W1e marker multi-device + handshake recovery", () => {
  beforeEach(async () => {
    resetLinkServiceHarnessState();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    getPubky.mockReset().mockResolvedValue(OWNER);
    getReceiver.mockReset().mockResolvedValue(receiver());
    getBudget.mockReset().mockResolvedValue(null);
    upsertBudget.mockReset().mockResolvedValue(undefined);
    clearBudget.mockReset().mockResolvedValue(undefined);
    deleteLink.mockReset().mockResolvedValue(undefined);
    upsertLink.mockReset().mockResolvedValue(undefined);
    closeLink.mockReset().mockResolvedValue(undefined);
    clearOutbox.mockReset().mockResolvedValue(undefined);
    deletePublic.mockReset().mockResolvedValue(undefined);
    receivePrivate.mockReset().mockResolvedValue({ messages: [], snapshot: "est" });
    upsertArchivedLink.mockReset().mockResolvedValue(undefined);
    getArchivedLink.mockReset().mockResolvedValue(null);
    getMarker.mockReset().mockResolvedValue({ noisePublicKey: "old-pk" });
    probeInbound.mockReset().mockResolvedValue({ result: "none" });
    initiateLink.mockReset().mockResolvedValue({ linkId: "init-1", snapshot: "init-snap" });
    advanceHandshake.mockReset().mockResolvedValue({ status: "pending", snapshot: "snap-1" });
    restoreHandshake.mockReset().mockResolvedValue({
      linkId: "hs-1",
      status: "pending",
      snapshot: "snap-1",
    });
    restoreLink.mockReset().mockResolvedValue({ linkId: "est-1" });
    getLink.mockReset();
    vi.mocked(takeoverReceiver).mockReset();
    vi.mocked(StorageService.getMessageRequest).mockReset().mockResolvedValue(null);
    vi.mocked(StorageService.getAllLinks).mockReset().mockResolvedValue([]);
    vi.mocked(StorageService.abandonOwedLinkMessagesForPeer).mockReset();
    vi.mocked(StorageService.markLinkReconnectRequired).mockReset().mockResolvedValue(undefined);
    applyKnownChatKind.mockReset().mockResolvedValue("unprocessed");
    vi.mocked(StorageService.markLinkStreamItemProcessedWithError).mockReset();
    await LinkService.adoptHarnessSession(handle() as never);
  });

  it("established link still restores after a foreign marker overwrite", async () => {
    getLink.mockResolvedValue({
      ...handshaking("stored-peer-pk"),
      role: "initiator",
      status: "established",
      snapshot: "HC1.opaque",
    });
    getMarker.mockResolvedValue({ noisePublicKey: "foreign-now" });
    const status = await LinkService.ensureLinkWith(PEER);
    expect(status).toBe("error");
    expect(restoreLink).toHaveBeenCalledWith(
      expect.anything(),
      "recv",
      PEER,
      "stored-peer-pk",
      LINK_RECEIVER_PATH,
      LINK_RECEIVER_PATH,
      "HC1.opaque",
    );
    expect(deleteLink).not.toHaveBeenCalled();
  });

  it("junk msg1 → nothing dropped", async () => {
    getLink.mockResolvedValue({ ...handshaking(), role: "responder" });
    probeInbound.mockResolvedValue({ result: "none" });
    await LinkService.ensureLinkWith(PEER);
    expect(deleteLink).not.toHaveBeenCalled();
  });

  it("initiator 3 no-advance polls + pk changed → wipe + re-initiate", async () => {
    getLink.mockResolvedValue(handshaking("old-pk"));
    getMarker.mockResolvedValue({ noisePublicKey: "new-pk" });
    await LinkService.ensureLinkWith(PEER);
    await LinkService.ensureLinkWith(PEER);
    expect(initiateLink).not.toHaveBeenCalled();
    await LinkService.ensureLinkWith(PEER);
    expect(deleteLink).toHaveBeenCalled();
    expect(initiateLink).toHaveBeenCalledWith(
      expect.anything(),
      "recv",
      PEER,
      "new-pk",
      LINK_RECEIVER_PATH,
      LINK_RECEIVER_PATH,
    );
    expect(upsertBudget).toHaveBeenCalled();
  });

  it("pk unchanged → no re-initiate after 3 polls", async () => {
    getLink.mockResolvedValue(handshaking("old-pk"));
    getMarker.mockResolvedValue({ noisePublicKey: "old-pk" });
    await LinkService.ensureLinkWith(PEER);
    await LinkService.ensureLinkWith(PEER);
    await LinkService.ensureLinkWith(PEER);
    expect(initiateLink).not.toHaveBeenCalled();
  });

  it("budget exhaustion stops re-initiate loops", async () => {
    getLink.mockResolvedValue(handshaking("old-pk"));
    getMarker.mockResolvedValue({ noisePublicKey: "new-pk" });
    getBudget.mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      pendingAdvances: 10,
      nextAdvanceAt: 0,
      exhaustedAt: NOW,
      updatedAt: NOW,
    });
    await LinkService.syncInbox([PEER]);
    await LinkService.syncInbox([PEER]);
    expect(initiateLink).not.toHaveBeenCalled();
  });

  it("automatic drain of a flapping peer exhausts the budget and fails the queue", async () => {
    let stored: ReturnType<typeof handshaking> | null = handshaking("old-pk");
    const budget = {
      ownerPubky: OWNER,
      peerPubky: PEER,
      pendingAdvances: 0,
      nextAdvanceAt: 0,
      exhaustedAt: null as number | null,
      updatedAt: NOW,
    };
    getLink.mockImplementation(async () => stored);
    upsertLink.mockImplementation(async (row: Record<string, unknown>) => {
      stored = {
        ...handshaking(String(row.remoteNoisePublicKey ?? "old-pk")),
        ...row,
        status: (row.status as "handshaking") ?? "handshaking",
        snapshot: String(row.snapshot ?? stored?.snapshot ?? "snap-1"),
        updatedAt: NOW,
        lastSeenPeerMarkerPk:
          (row.lastSeenPeerMarkerPk as string | null | undefined) ??
          stored?.lastSeenPeerMarkerPk ??
          null,
      } as ReturnType<typeof handshaking>;
    });
    deleteLink.mockImplementation(async () => {
      stored = null;
    });
    getBudget.mockImplementation(async () =>
      budget.pendingAdvances === 0 && budget.exhaustedAt === null ? null : { ...budget },
    );
    upsertBudget.mockImplementation(async (row: {
      pendingAdvances: number;
      nextAdvanceAt: number;
      exhaustedAt: number | null;
    }) => {
      budget.pendingAdvances = row.pendingAdvances;
      budget.nextAdvanceAt = row.nextAdvanceAt;
      budget.exhaustedAt = row.exhaustedAt;
    });
    clearBudget.mockImplementation(async () => {
      budget.pendingAdvances = 0;
      budget.nextAdvanceAt = 0;
      budget.exhaustedAt = null;
    });
    let flap = 0;
    getMarker.mockImplementation(async () => ({
      noisePublicKey: `flap-${flap++}`,
          }));
    advanceHandshake.mockImplementation(async () => ({
      status: "pending",
      snapshot: stored?.snapshot ?? "snap-1",
    }));
    restoreHandshake.mockImplementation(async () => ({
      linkId: "hs-1",
      status: "pending",
      snapshot: stored?.snapshot ?? "snap-1",
    }));

    const eventId = "11111111-1111-4111-8111-111111111111";
    const queueItem = {
      id: "q-flap",
      messageId: eventId,
      recipientPubky: PEER,
      payload: JSON.stringify({
        type: "link.chat.message",
        ownerPubky: OWNER,
        peerPubky: PEER,
        senderPubky: OWNER,
        kind: "chat.message.v0",
        eventId,
        rawJson: "{}",
      }),
      attempts: 0,
      nextRetryAt: 0,
      createdAt: NOW,
    };
    vi.mocked(RetryQueue.getDue).mockResolvedValue([queueItem]);
    vi.mocked(StorageService.listDeliveryQueue).mockResolvedValue([queueItem]);
    vi.mocked(StorageService.getLinkMessage).mockResolvedValue({
      ownerPubky: OWNER,
      eventId,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: "sent",
      kind: "chat.message.v0",
      rawJson: "{}",
      body: "hi",
      sentAt: NOW,
      receivedAt: null,
      deliveryState: "sending",
    });

    const abandon = vi.mocked(StorageService.abandonOwedLinkMessagesForPeer);
    abandon.mockClear();
    initiateLink.mockClear();

    for (let i = 0; i < 40 && abandon.mock.calls.length === 0; i += 1) {
      await LinkService.drainRetries();
    }

    expect(abandon).toHaveBeenCalledWith(OWNER, PEER);
    expect(budget.exhaustedAt).not.toBeNull();
    expect(budget.pendingAdvances).toBeGreaterThanOrEqual(10);
    const initiatesBeforeUser = initiateLink.mock.calls.length;

    await LinkService.drainRetries();
    expect(initiateLink.mock.calls.length).toBe(initiatesBeforeUser);

    const status = await LinkService.ensureLinkWith(PEER);
    expect(clearBudget).toHaveBeenCalled();
    expect(initiateLink.mock.calls.length).toBe(initiatesBeforeUser + 1);
    expect(status).toBe("handshaking-initiator");
  });

  it("standby + no established link blocks send before queueing", async () => {
    getReceiver.mockResolvedValue({ ...receiver(), receiverRole: "standby" });
    getLink.mockResolvedValue(null);
    await expect(LinkService.sendDm(PEER, "hello")).rejects.toThrow(
      "This device isn't receiving new chats. Receive on this device to start this conversation.",
    );
    expect(initiateLink).not.toHaveBeenCalled();
    expect(StorageService.persistLinkSendIntent).not.toHaveBeenCalled();
  });

  it("standby + established link still allows send", async () => {
    getReceiver.mockResolvedValue({ ...receiver(), receiverRole: "standby" });
    getLink.mockResolvedValue({
      ...handshaking("stored-peer-pk"),
      status: "established",
      snapshot: "HC1.opaque",
    });
    getMarker.mockResolvedValue({ noisePublicKey: "stored-peer-pk" });
    const persistIntent = vi.mocked(StorageService.persistLinkSendIntent);
    persistIntent.mockResolvedValue(undefined);
    vi.mocked(StorageService.finalizeLinkSend).mockResolvedValue(undefined);
    const status = await LinkService.ensureLinkWith(PEER);
    expect(status).toBe("ready");
    expect(initiateLink).not.toHaveBeenCalled();
  });

  it("queued then takeover wipes unestablished handshake and re-initiates once", async () => {
    let stored: ReturnType<typeof handshaking> | null = handshaking("dead-pk");
    getReceiver.mockResolvedValue({ ...receiver(), receiverRole: "active" });
    getLink.mockImplementation(async () => stored);
    vi.mocked(StorageService.getAllLinks).mockResolvedValue([handshaking("dead-pk")]);
    vi.mocked(StorageService.listOwedOutboundLinkMessages).mockResolvedValue([
      {
        ownerPubky: OWNER,
        eventId: "11111111-1111-4111-8111-111111111111",
        conversationId: `dm:${PEER}`,
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: "sent",
        kind: "chat.message.v0",
        rawJson: "{}",
        body: "queued",
        sentAt: NOW,
        receivedAt: null,
        deliveryState: "sending",
      },
    ]);
    deleteLink.mockImplementation(async () => {
      stored = null;
    });
    upsertLink.mockImplementation(async (row: Record<string, unknown>) => {
      stored = {
        ...handshaking(String(row.remoteNoisePublicKey ?? "new-pk")),
        ...row,
        status: "handshaking",
        snapshot: String(row.snapshot ?? "init-snap"),
        updatedAt: NOW,
      } as ReturnType<typeof handshaking>;
    });
    getMarker.mockResolvedValue({ noisePublicKey: "live-pk" });
    initiateLink.mockResolvedValue({ linkId: "init-2", snapshot: "init-snap-2" });
    advanceHandshake.mockResolvedValue({ status: "pending", snapshot: "init-snap-2" });

    await LinkService.restartQueuedUnestablishedHandshakes();

    expect(deleteLink).toHaveBeenCalled();
    expect(clearOutbox).not.toHaveBeenCalled();
    expect(initiateLink).toHaveBeenCalledTimes(1);
    expect(initiateLink).toHaveBeenCalledWith(
      expect.anything(),
      "recv",
      PEER,
      "live-pk",
      LINK_RECEIVER_PATH,
      LINK_RECEIVER_PATH,
    );
    expect(clearBudget).toHaveBeenCalled();
  });

  it("takeover skips a reconnect-required row", async () => {
    const reconnectRequired = {
      ...handshaking("dead-pk"),
      status: "reconnect_required" as const,
      snapshot: "retained-snapshot",
    };
    getReceiver.mockResolvedValue({ ...receiver(), receiverRole: "active" });
    getLink.mockResolvedValue(reconnectRequired);
    vi.mocked(StorageService.getAllLinks).mockResolvedValue([reconnectRequired]);

    await LinkService.restartQueuedUnestablishedHandshakes();

    expect(clearBudget).not.toHaveBeenCalled();
    expect(deleteLink).not.toHaveBeenCalled();
    expect(upsertArchivedLink).not.toHaveBeenCalled();
    expect(initiateLink).not.toHaveBeenCalled();
  });

  it("standby + existing handshaking row blocks send with typed error", async () => {
    getReceiver.mockResolvedValue({ ...receiver(), receiverRole: "standby" });
    getLink.mockResolvedValue(handshaking("wedged-pk"));
    await expect(LinkService.sendDm(PEER, "hello")).rejects.toEqual(
      expect.objectContaining({
        name: "LinkSendError",
        code: "standby-not-receiving",
      }),
    );
    await expect(LinkService.sendDm(PEER, "hello")).rejects.toBeInstanceOf(LinkSendError);
    expect(restoreHandshake).not.toHaveBeenCalled();
    expect(initiateLink).not.toHaveBeenCalled();
    expect(StorageService.persistLinkSendIntent).not.toHaveBeenCalled();
  });

  it("standby + handshaking persists no sendPreparedMessage", async () => {
    getReceiver.mockResolvedValue({ ...receiver(), receiverRole: "standby" });
    getLink.mockResolvedValue({ ...handshaking("wedged-pk"), role: "responder" });
    await expect(
      LinkService.sendPreparedMessage({
        peerPubky: PEER,
        kind: "chat.message.v0",
        eventId: "11111111-1111-4111-8111-111111111111",
        rawJson: "{}",
        body: "hi",
        sentAt: NOW,
      }),
    ).rejects.toMatchObject({ code: "standby-not-receiving" });
    expect(StorageService.persistLinkSendIntent).not.toHaveBeenCalled();
  });

  it("standby + handshaking drain stays queued", async () => {
    getReceiver.mockResolvedValue({ ...receiver(), receiverRole: "standby" });
    getLink.mockResolvedValue(handshaking("wedged-pk"));
    const result = await LinkService.attemptPersistedSend({
      peerPubky: PEER,
      kind: "chat.message.v0",
      eventId: "11111111-1111-4111-8111-111111111111",
      queueId: "q1",
      rawJson: "{}",
    });
    expect(result).toBe("queued");
    expect(restoreHandshake).not.toHaveBeenCalled();
    expect(initiateLink).not.toHaveBeenCalled();
  });

  it("getLinkStatus reports restoring until an established handle exists", async () => {
    getLink.mockResolvedValue({
      ...handshaking("stored-peer-pk"),
      status: "established",
      snapshot: "",
    });
    expect(await LinkService.getLinkStatus(PEER)).toBe("restoring");
    getLink.mockResolvedValue({
      ...handshaking("stored-peer-pk"),
      status: "established",
      snapshot: "HC1.opaque",
    });
    expect(await LinkService.getLinkStatus(PEER)).toBe("restoring");
    getMarker.mockResolvedValue({ noisePublicKey: "stored-peer-pk" });
    restoreLink.mockResolvedValue({ linkId: "restored-live" });
    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("ready");
    expect(await LinkService.getLinkStatus(PEER)).toBe("ready");
  });

  it("getLinkStatus reports restoring when an established peer marker has moved", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-peer-pk"),
      status: "established",
      snapshot: "HC1.opaque",
      remoteNoisePublicKey: "old-peer-pk",
      lastSeenPeerMarkerPk: "new-peer-pk",
    });
    expect(await LinkService.getLinkStatus(PEER)).toBe("restoring");
  });

  it("takeover on a budget-exhausted peer resets budget and re-initiates without failing queued", async () => {
    let stored: ReturnType<typeof handshaking> | null = handshaking("dead-pk");
    getReceiver.mockResolvedValue({ ...receiver(), receiverRole: "active" });
    getBudget.mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      pendingAdvances: 10,
      nextAdvanceAt: NOW,
      exhaustedAt: NOW,
    });
    getLink.mockImplementation(async () => stored);
    vi.mocked(StorageService.getAllLinks).mockResolvedValue([handshaking("dead-pk")]);
    vi.mocked(StorageService.listOwedOutboundLinkMessages).mockResolvedValue([
      {
        ownerPubky: OWNER,
        eventId: "11111111-1111-4111-8111-111111111111",
        conversationId: `dm:${PEER}`,
        peerPubky: PEER,
        senderPubky: OWNER,
        direction: "sent",
        kind: "chat.message.v0",
        rawJson: "{}",
        body: "queued",
        sentAt: NOW,
        receivedAt: null,
        deliveryState: "sending",
      },
    ]);
    deleteLink.mockImplementation(async () => {
      stored = null;
    });
    upsertLink.mockImplementation(async (row: Record<string, unknown>) => {
      stored = {
        ...handshaking(String(row.remoteNoisePublicKey ?? "new-pk")),
        ...row,
        status: "handshaking",
        snapshot: String(row.snapshot ?? "init-snap"),
        updatedAt: NOW,
      } as ReturnType<typeof handshaking>;
    });
    getMarker.mockResolvedValue({ noisePublicKey: "live-pk" });
    initiateLink.mockResolvedValue({ linkId: "init-2", snapshot: "init-snap-2" });
    advanceHandshake.mockResolvedValue({ status: "pending", snapshot: "init-snap-2" });

    await LinkService.restartQueuedUnestablishedHandshakes();

    expect(clearBudget).toHaveBeenCalled();
    expect(StorageService.abandonOwedLinkMessagesForPeer).not.toHaveBeenCalled();
    expect(initiateLink).toHaveBeenCalledTimes(1);
    expect(deleteLink).toHaveBeenCalled();
  });

  it("concurrent takeOverReceiver shares one in-flight PUT", async () => {
    let release: (value: {
      pubky: string;
      receiverPath: string;
      noisePublicKey: string;
      receiverRole: "active";
    }) => void = () => undefined;
    vi.mocked(takeoverReceiver).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    vi.mocked(StorageService.getAllLinks).mockResolvedValue([]);
    const first = LinkService.takeOverReceiver();
    const second = LinkService.takeOverReceiver();
    release({
      pubky: OWNER,
      receiverPath: LINK_RECEIVER_PATH,
      noisePublicKey: "local-pk",
      receiverRole: "active",
    });
    await Promise.all([first, second]);
    expect(takeoverReceiver).toHaveBeenCalledTimes(1);
  });

  it("orphan msg1 + marker rollback parks without wedging the established link", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      role: "responder",
      status: "established",
      snapshot: "est-old",
    });
    restoreLink.mockResolvedValue({ linkId: "est-live" });
    getMarker.mockResolvedValue({ noisePublicKey: "rolled-back-pk" });
    probeInbound.mockResolvedValue({
      result: "pending",
      linkId: "orphan-hs",
      snapshot: "orphan-snap",
    });

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

    expect(closeLink).not.toHaveBeenCalledWith("est-live");
    expect(upsertLink).not.toHaveBeenCalledWith(expect.objectContaining({ status: "superseded" }));
    expect(upsertLink).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "handshaking", snapshot: "orphan-snap" }),
    );
    expect(upsertArchivedLink).not.toHaveBeenCalled();
  });

  it("established re-key supersedes only after the new handshake reaches established", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      role: "responder",
      status: "established",
      snapshot: "est-old",
    });
    vi.mocked(StorageService.getMessageRequest).mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: "accepted",
    });
    vi.mocked(StorageService.countLinkMessagesForPeer).mockResolvedValue(4);
    restoreLink.mockResolvedValue({ linkId: "est-live" });
    getMarker.mockResolvedValue({ noisePublicKey: "new-pk" });
    probeInbound.mockResolvedValue({
      result: "pending",
      linkId: "rekey-hs",
      snapshot: "rekey-snap",
    });
    advanceHandshake.mockResolvedValue({ status: "pending", snapshot: "rekey-snap" });

    await LinkService.syncInbox([PEER]);
    expect(closeLink).not.toHaveBeenCalledWith("est-live");
    expect(upsertArchivedLink).not.toHaveBeenCalled();

    advanceHandshake.mockResolvedValue({ status: "established", snapshot: "rekey-est" });
    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

    expect(closeLink).toHaveBeenCalledWith("est-live");
    expect(upsertArchivedLink).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: "est-old", remoteNoisePublicKey: "old-pk" }),
    );
    expect(upsertLink).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "responder",
        status: "established",
        snapshot: "rekey-est",
        remoteNoisePublicKey: "new-pk",
      }),
    );
    expect(deleteLink).not.toHaveBeenCalled();
    expect(StorageService.deleteLinkMessagesForPeer).not.toHaveBeenCalled();
    expect(StorageService.upsertMessageRequest).not.toHaveBeenCalled();
  });

  it("adopted handshake age-out falls back to the still-live old link", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "established",
      snapshot: "est-old",
    });
    restoreLink.mockResolvedValue({ linkId: "est-live" });
    getMarker.mockResolvedValue({ noisePublicKey: "new-pk" });
    probeInbound.mockResolvedValue({
      result: "pending",
      linkId: "rekey-hs",
      snapshot: "rekey-snap",
    });

    await LinkService.syncInbox([PEER]);
    vi.spyOn(Date, "now").mockReturnValue(NOW + HANDSHAKE_STALE_MS);
    await LinkService.syncInbox([PEER]);

    expect(closeLink).toHaveBeenCalledWith("rekey-hs");
    expect(closeLink).not.toHaveBeenCalledWith("est-live");
    expect(upsertArchivedLink).not.toHaveBeenCalled();
    expect(upsertLink).not.toHaveBeenCalledWith(expect.objectContaining({ status: "handshaking" }));
  });

  it("drains in-flight inbound on the old handle before supersede close", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      role: "responder",
      status: "established",
      snapshot: "est-old",
    });
    restoreLink.mockResolvedValue({ linkId: "est-live" });
    getMarker.mockResolvedValue({ noisePublicKey: "new-pk" });
    probeInbound.mockResolvedValue({
      result: "established",
      linkId: "rekey-est",
      snapshot: "rekey-est-snap",
    });
    receivePrivate.mockResolvedValue({
      messages: [{ kind: "chat.message", rawJson: '{"kind":"chat.message"}' }],
      snapshot: "est-drained",
    });

    await LinkService.syncInbox([PEER]);

    expect(receivePrivate).toHaveBeenCalled();
    expect(StorageService.saveLinkStreamItems).toHaveBeenCalled();
    expect(closeLink).toHaveBeenCalledWith("est-live");
    expect(upsertArchivedLink).toHaveBeenCalled();
  });

  it("does not clear the initiator outbox (msg3) after the link becomes established", async () => {
    getLink.mockResolvedValue(handshaking("old-pk"));
    restoreHandshake.mockResolvedValue({ linkId: "hs-1", status: "pending" });
    advanceHandshake.mockResolvedValue({ status: "established", snapshot: "est-snap" });
    restoreLink.mockResolvedValue({ linkId: "est-new" });

    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("ready");

    // Orphan msg1 is retained as garbage; it is never remotely deleted.
    expect(clearOutbox).not.toHaveBeenCalled();
  });

  it("fails closed when established restore is unavailable", async () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../../fixtures/link-reconnect/live-homeserver-shape.json", import.meta.url),
        "utf8",
      ),
    ) as { peer: { slots: Record<string, number> } };
    const slots = new Map(Object.entries(fixture.peer.slots));
    const originalSlots = new Map(slots);
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "established",
      snapshot: "est-snap",
    });
    restoreLink.mockImplementation(async () => {
      if ([...slots.values()].some((status) => status === 404)) {
        throw createLinkNativeError("network", "historical slot unavailable");
      }
      return { linkId: "old-live" };
    });

    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("reconnect_required");

    expect(clearOutbox).not.toHaveBeenCalled();
    expect(deleteLink).not.toHaveBeenCalled();
    expect(StorageService.markLinkReconnectRequired).toHaveBeenCalledWith(
      OWNER,
      PEER,
      "network",
    );
    expect(slots).toEqual(originalSlots);
  });

  it("reconnect_required + rotated peer marker retires locally and starts a fresh handshake", async () => {
    // Captured 2026-09-15 from gate-final/REPORT.md:51-145: peer outbox slots
    // stay 404/200/404. Adoption must not DELETE those homeserver paths.
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../../fixtures/link-reconnect/live-homeserver-shape.json", import.meta.url),
        "utf8",
      ),
    ) as { peer: { slots: Record<string, number> } };
    const slots = new Map(Object.entries(fixture.peer.slots));
    const originalSlots = new Map(slots);

    let stored: HarnessLinkRow | null = {
      ...handshaking("old-pk"),
      status: "reconnect_required",
      snapshot: "stale-est-snap",
    };
    getLink.mockImplementation(async () => stored);
    deleteLink.mockImplementation(async () => {
      stored = null;
    });
    upsertLink.mockImplementation(async (row: Record<string, unknown>) => {
      stored = {
        ...handshaking(String(row.remoteNoisePublicKey ?? "new-pk")),
        ...row,
        status: "handshaking",
        snapshot: String(row.snapshot ?? "init-rotated-snap"),
        updatedAt: NOW,
      };
    });
    getMarker.mockResolvedValue({ noisePublicKey: "new-pk" });
    initiateLink.mockResolvedValue({ linkId: "init-rotated", snapshot: "init-rotated-snap" });
    advanceHandshake.mockResolvedValue({ status: "pending", snapshot: "init-rotated-snap" });

    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("handshaking-initiator");

    expect(upsertArchivedLink).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "reconnect_required",
        remoteNoisePublicKey: "old-pk",
        snapshot: "stale-est-snap",
      }),
    );
    expect(deleteLink).toHaveBeenCalledWith(OWNER, PEER);
    expect(initiateLink).toHaveBeenCalledWith(
      expect.anything(),
      "recv",
      PEER,
      "new-pk",
      LINK_RECEIVER_PATH,
      LINK_RECEIVER_PATH,
    );
    expect(clearOutbox).not.toHaveBeenCalled();
    expect(deletePublic).not.toHaveBeenCalled();
    expect(StorageService.abandonOwedLinkMessagesForPeer).not.toHaveBeenCalled();
    expect(slots).toEqual(originalSlots);
  });

  it("reconnect_required + unchanged peer marker stays fail-closed", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "reconnect_required" as const,
      snapshot: "stale-est-snap",
    });
    getMarker.mockResolvedValue({ noisePublicKey: "old-pk" });

    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("reconnect_required");

    expect(initiateLink).not.toHaveBeenCalled();
    expect(deleteLink).not.toHaveBeenCalled();
    expect(clearOutbox).not.toHaveBeenCalled();
    expect(deletePublic).not.toHaveBeenCalled();
  });

  it("reconnect_required + marker fetch failure stays fail-closed", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "reconnect_required" as const,
      snapshot: "stale-est-snap",
    });
    getMarker.mockRejectedValue(new Error("homeserver unreachable"));

    await expect(LinkService.ensureLinkWith(PEER)).resolves.toBe("reconnect_required");

    expect(initiateLink).not.toHaveBeenCalled();
    expect(deleteLink).not.toHaveBeenCalled();
    expect(clearOutbox).not.toHaveBeenCalled();
    expect(deletePublic).not.toHaveBeenCalled();
  });

  it("inbox tick does not initiate reconnect_required except after a marker rotation check", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "reconnect_required" as const,
      snapshot: "stale-est-snap",
    });
    getMarker.mockResolvedValue({ noisePublicKey: "old-pk" });

    await LinkService.syncInbox([PEER]);
    await LinkService.syncInbox([PEER]);

    expect(initiateLink).not.toHaveBeenCalled();
    expect(deleteLink).not.toHaveBeenCalled();
    expect(getMarker).toHaveBeenCalledTimes(1);
    expect(clearOutbox).not.toHaveBeenCalled();
  });

  it("keeps the LinkService source free of remote outbox deletion calls", () => {
    const source = readFileSync(new URL("./LinkService.ts", import.meta.url), "utf8");
    expect(source).not.toContain("clearLinkOutbox");
    expect(source).not.toContain("clearAbandonedInitiatorOutbox");
  });

  it("marks receive and tag-routing failures without clearing slots", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "established",
      snapshot: "old-snapshot",
    });
    restoreLink.mockResolvedValue({ linkId: "old-live" });
    receivePrivate.mockRejectedValue(new Error("tag URL should never reach UI"));

    await LinkService.syncInbox([PEER]);

    expect(StorageService.markLinkReconnectRequired).toHaveBeenCalledWith(
      OWNER,
      PEER,
      "application",
    );
    expect(clearOutbox).not.toHaveBeenCalled();
  });

  it("isolates an application routing error and continues with later items", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "established",
      snapshot: "old-snapshot",
    });
    restoreLink.mockResolvedValue({ linkId: "old-live" });
    const first = {
      id: "bad-tag",
      ownerPubky: OWNER,
      peerPubky: PEER,
      kind: CHAT_TAG_KIND,
      rawJson: '{"kind":"chat.tag.v0","label":"invalid"}',
      receivedAt: NOW,
      processed: false,
    };
    const second = {
      id: "good-text",
      ownerPubky: OWNER,
      peerPubky: PEER,
      kind: CHAT_MESSAGE_KIND,
      rawJson: JSON.stringify({
        version: 1,
        kind: CHAT_MESSAGE_KIND,
        event_id: EVENT_ID,
        sent_at: NOW,
        body: "delivered after bad tag",
      }),
      receivedAt: NOW + 1,
      processed: false,
    };
    vi.mocked(StorageService.getUnprocessedLinkStreamItems).mockResolvedValue([first, second]);
    applyKnownChatKind.mockRejectedValueOnce(new Error("chat.tag.v0 label is invalid"));
    receivePrivate.mockResolvedValue({ messages: [], snapshot: "old-snapshot" });

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([
      expect.objectContaining({ body: "delivered after bad tag" }),
    ]);

    expect(StorageService.markLinkStreamItemProcessedWithError).toHaveBeenCalledWith(
      "bad-tag",
      "application",
    );
    expect(StorageService.markLinkStreamItemProcessed).toHaveBeenCalledWith("good-text");
    expect(StorageService.markLinkReconnectRequired).not.toHaveBeenCalled();
    expect(
      JSON.stringify(vi.mocked(StorageService.markLinkStreamItemProcessedWithError).mock.calls),
    ).not.toContain("chat.tag.v0 label is invalid");
  });

  it("keeps boundary protocol failures fail-closed", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "established",
      snapshot: "old-snapshot",
    });
    restoreLink.mockResolvedValue({ linkId: "old-live" });
    vi.mocked(StorageService.getUnprocessedLinkStreamItems).mockResolvedValue([
      {
        id: "protocol-item",
        ownerPubky: OWNER,
        peerPubky: PEER,
        kind: CHAT_TAG_KIND,
        rawJson: '{"kind":"chat.tag.v0","label":"invalid"}',
        receivedAt: NOW,
        processed: false,
      },
    ]);
    applyKnownChatKind.mockRejectedValue(
      createLinkNativeError("protocol", "wire failure"),
    );

    await expect(LinkService.syncInbox([PEER])).resolves.toEqual([]);

    expect(StorageService.markLinkReconnectRequired).toHaveBeenCalledWith(
      OWNER,
      PEER,
      "protocol",
    );
  });

  it("declined inbound races only retire local state", async () => {
    vi.mocked(StorageService.getMessageRequest).mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      status: "declined",
      createdAt: NOW,
      updatedAt: NOW,
    });
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "established",
      snapshot: "old-snapshot",
    });

    await LinkService.syncInbox([PEER]);

    expect(clearOutbox).not.toHaveBeenCalled();
    expect(deleteLink).toHaveBeenCalledWith(OWNER, PEER);
  });

  it("retains the retired predecessor on per-link reset and decline", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "established",
      snapshot: "est-old",
    });

    await LinkService.resetEncryptedLink(PEER);
    expect(upsertArchivedLink).toHaveBeenCalled();

    vi.mocked(upsertArchivedLink).mockClear();
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "established",
      snapshot: "est-old",
    });
    await LinkService.declineMessageRequest(PEER);
    expect(upsertArchivedLink).toHaveBeenCalled();
  });

  it("pk unchanged + junk msg1 → established link unchanged", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "established",
      snapshot: "est-old",
    });
    restoreLink.mockResolvedValue({ linkId: "est-live" });
    getMarker.mockResolvedValue({ noisePublicKey: "old-pk" });
    probeInbound.mockResolvedValue({
      result: "pending",
      linkId: "junk-hs",
      snapshot: "junk-snap",
    });

    await LinkService.syncInbox([PEER]);

    expect(probeInbound).not.toHaveBeenCalled();
    expect(deleteLink).not.toHaveBeenCalled();
    expect(upsertLink).not.toHaveBeenCalledWith(expect.objectContaining({ status: "superseded" }));
  });

  it("pk changed + undecryptable msg1 → established link unchanged", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "established",
      snapshot: "est-old",
    });
    restoreLink.mockResolvedValue({ linkId: "est-live" });
    getMarker.mockResolvedValue({ noisePublicKey: "new-pk" });
    probeInbound.mockRejectedValue(createLinkNativeError("protocol", "undecryptable msg1"));

    await LinkService.syncInbox([PEER]);

    expect(upsertLink).not.toHaveBeenCalledWith(expect.objectContaining({ status: "superseded" }));
    expect(deleteLink).not.toHaveBeenCalled();
    expect(closeLink).not.toHaveBeenCalled();
  });

  it("denied peer → no re-key adopt", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "established",
      snapshot: "est-old",
    });
    vi.mocked(StorageService.getMessageRequest).mockResolvedValue({
      ownerPubky: OWNER,
      peerPubky: PEER,
      createdAt: NOW,
      updatedAt: NOW,
      status: "declined",
    });
    restoreLink.mockResolvedValue({ linkId: "est-live" });
    getMarker.mockResolvedValue({ noisePublicKey: "new-pk" });
    probeInbound.mockResolvedValue({
      result: "pending",
      linkId: "hostile-hs",
      snapshot: "hostile-snap",
    });

    await LinkService.syncInbox([PEER]);

    expect(probeInbound).not.toHaveBeenCalled();
    expect(upsertLink).not.toHaveBeenCalledWith(expect.objectContaining({ status: "superseded" }));
  });

  it("ready peer marker GET at most once per 60s", async () => {
    getLink.mockResolvedValue({
      ...handshaking("old-pk"),
      status: "established",
      snapshot: "est-old",
    });
    restoreLink.mockResolvedValue({ linkId: "est-live" });
    getMarker.mockResolvedValue({ noisePublicKey: "old-pk" });

    await LinkService.syncInbox([PEER]);
    await LinkService.syncInbox([PEER]);
    expect(getMarker).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, "now").mockReturnValue(NOW + PEER_MARKER_REFRESH_TTL_MS);
    await LinkService.syncInbox([PEER]);
    expect(getMarker).toHaveBeenCalledTimes(2);
  });
});
