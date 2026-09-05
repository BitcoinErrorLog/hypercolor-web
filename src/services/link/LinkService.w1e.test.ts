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
      receivePrivateMessages: vi.fn(async () => ({ messages: [], snapshot: "est" })),
      clearLinkOutbox: (...args: unknown[]) => clearOutbox(...args),
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
    recordLastSeenPeerMarkerPk: vi.fn(),
    updateLinkSnapshot: vi.fn(),
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
  },
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
  provisionReceiver: vi.fn(),
  syncOwnReceiverRole: vi.fn(),
  takeoverReceiver: vi.fn(),
}));

import { LinkService, resetLinkServiceHarnessState } from "./LinkService";
import { LinkSendError } from "./LinkSendError";
import { LINK_RECEIVER_PATH } from "../../types/link";
import { RetryQueue } from "@/services/RetryQueue";
import { StorageService } from "@/services/StorageService";
import { takeoverReceiver } from "./provisionReceiver";

const OWNER = "a".repeat(52);
const PEER = "z".repeat(52);
const NOW = 1_700_000_000_000;

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
    getMarker.mockReset().mockResolvedValue({ noisePublicKey: "old-pk", capabilitiesJson: "{}" });
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
    vi.mocked(StorageService.getAllLinks).mockReset().mockResolvedValue([]);
    vi.mocked(StorageService.abandonOwedLinkMessagesForPeer).mockReset();
    await LinkService.adoptHarnessSession(handle() as never);
  });

  it("established link still restores after a foreign marker overwrite", async () => {
    getLink.mockResolvedValue({
      ...handshaking("stored-peer-pk"),
      role: "initiator",
      status: "established",
      snapshot: "HC1.opaque",
    });
    getMarker.mockResolvedValue({ noisePublicKey: "foreign-now", capabilitiesJson: "{}" });
    const status = await LinkService.ensureLinkWith(PEER);
    expect(status).toBe("ready");
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

  it("responder pending + valid new msg1 → drop pending + adopt", async () => {
    getLink.mockResolvedValue({ ...handshaking(), role: "responder" });
    probeInbound.mockResolvedValue({
      result: "pending",
      linkId: "new-hs",
      snapshot: "new-snap",
    });
    const status = await LinkService.ensureLinkWith(PEER);
    expect(status).toBe("handshaking-responder");
    expect(deleteLink).toHaveBeenCalled();
    expect(upsertLink).toHaveBeenCalledWith(
      expect.objectContaining({ role: "responder", snapshot: "new-snap" }),
    );
  });

  it("junk msg1 → nothing dropped", async () => {
    getLink.mockResolvedValue({ ...handshaking(), role: "responder" });
    probeInbound.mockResolvedValue({ result: "none" });
    await LinkService.ensureLinkWith(PEER);
    expect(deleteLink).not.toHaveBeenCalled();
  });

  it("initiator 3 no-advance polls + pk changed → wipe + re-initiate", async () => {
    getLink.mockResolvedValue(handshaking("old-pk"));
    getMarker.mockResolvedValue({ noisePublicKey: "new-pk", capabilitiesJson: "{}" });
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
    getMarker.mockResolvedValue({ noisePublicKey: "old-pk", capabilitiesJson: "{}" });
    await LinkService.ensureLinkWith(PEER);
    await LinkService.ensureLinkWith(PEER);
    await LinkService.ensureLinkWith(PEER);
    expect(initiateLink).not.toHaveBeenCalled();
  });

  it("budget exhaustion stops re-initiate loops", async () => {
    getLink.mockResolvedValue(handshaking("old-pk"));
    getMarker.mockResolvedValue({ noisePublicKey: "new-pk", capabilitiesJson: "{}" });
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
      capabilitiesJson: "{}",
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
    getMarker.mockResolvedValue({ noisePublicKey: "live-pk", capabilitiesJson: "{}" });
    initiateLink.mockResolvedValue({ linkId: "init-2", snapshot: "init-snap-2" });
    advanceHandshake.mockResolvedValue({ status: "pending", snapshot: "init-snap-2" });

    await LinkService.restartQueuedUnestablishedHandshakes();

    expect(deleteLink).toHaveBeenCalled();
    expect(clearOutbox).toHaveBeenCalled();
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

  it("getLinkStatus uses snapshot/live ready predicate not a bare established row", async () => {
    getLink.mockResolvedValue({
      ...handshaking("stored-peer-pk"),
      status: "established",
      snapshot: "",
    });
    expect(await LinkService.getLinkStatus(PEER)).toBe("handshaking-initiator");
    getLink.mockResolvedValue({
      ...handshaking("stored-peer-pk"),
      status: "established",
      snapshot: "HC1.opaque",
    });
    expect(await LinkService.getLinkStatus(PEER)).toBe("ready");
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
    getMarker.mockResolvedValue({ noisePublicKey: "live-pk", capabilitiesJson: "{}" });
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
});
