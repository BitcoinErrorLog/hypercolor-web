import {
  PaykitLinkWeb,
  createLinkNativeError,
  isLinkNativeError,
  type LinkNativeError,
  type LinkProbeResult,
  type ReceiverMarker,
  type SessionHandle,
} from "./PaykitLinkWeb";
import { StorageService } from "../StorageService";
import { KeyStore } from "../KeyStore";
import { RetryQueue, isRetired, nextAttemptAt } from "../RetryQueue";
import { hexToBytes } from "@/lib/hex";
import {
  RING_GRANT_CAPABILITIES,
  LINK_RECEIVER_PATH,
  assertValidReceiverPath,
  buildChatMessageEnvelope,
  buildDmConversationId,
  CHAT_MESSAGE_KIND,
  coerceReceiverPath,
  decodeLinkEnvelope,
  type LinkDeliveryState,
  type LinkMessage,
  type LinkReceiver,
  type LinkRecord,
  type LinkRole,
  type LinkStatus,
  type LinkStreamItemInput,
} from "../../types/link";
import type { DeliveryQueueItem, PubkyKey } from "../../types";
import {
  decodeGroupEnvelope,
  isGroupWireKind,
  LINK_GROUP_FANOUT_PAYLOAD_TYPE,
  peekEnvelopeKind,
} from "../../types/group";
import { applyGroupInbound } from "../group/applyGroupInbound";
import { classifyInboundPeer, wotInputFromContact } from "./wotGate";
import {
  attachmentKeyRef,
  CHAT_ATTACHMENT_KIND,
  decodeAttachmentEnvelope,
  isAttachmentLocationBoundToSender,
  redactAttachmentRawJson,
} from "../../types/attachment";
import { applyAttachmentInbound } from "../attachments/applyAttachmentInbound";
import {
  fingerprintStoredAttachmentSecret,
  reconstructAttachmentWireJson,
} from "../attachments/redaction";
import { applyPaymentInbound } from "../payments/applyPaymentInbound";
import { isPaykitPaymentKind } from "../../types/payment";
import { shouldDropOversizedKnownInbound } from "./inboundEnvelope";
import { provisionReceiver, syncOwnReceiverRole, takeoverReceiver } from "./provisionReceiver";
import { STANDBY_COMPOSER_NOTICE } from "@/lib/delivery-status";
import { LinkSendError } from "./LinkSendError";
import {
  adoptApprovedSession,
  adoptLiveHandle,
  getLiveSession,
  restoreSessionOnLoad,
  signOut,
  getEnableStatus as sessionEnableStatus,
} from "./session";

/**
 * LinkService — E2EE DMs over official Paykit Encrypted Links via PaykitLinkWeb.
 *
 * Snapshots are opaque wrapped strings. This file persists them and passes
 * them back, and never parses the inner wasm bytes.
 */

export const LINK_RETRY_PAYLOAD_TYPE = "link.chat.message";

export { LINK_GROUP_FANOUT_PAYLOAD_TYPE };

export const HANDSHAKE_FAILURE_LIMIT = 5;

/** Unproductive handshake steps against one peer before abandonment. */
export const HANDSHAKE_PENDING_ADVANCE_LIMIT = 10;

/** Composer / user-driven ensure vs automatic retry/inbox. */
export type HandshakeIntent = "user" | "auto";

/** Non-ready links older than this are wiped so a later probe can adopt a fresh msg1. */
export const HANDSHAKE_STALE_MS = 10 * 60 * 1000;

/** Initiator C: re-GET the peer marker after this many no-advance polls. */
export const MARKER_RECOVERY_POLL_LIMIT = 3;

/** Initiator C: re-GET the peer marker after this much wall time without advance. */
export const MARKER_RECOVERY_TIMEOUT_MS = 120_000;

export const LINK_RETRY_DRAIN_INTERVAL_MS = 30_000;

/**
 * Ready-link peer-marker refresh cadence. syncInbox may GET a ready peer's
 * marker at most once per this window, and probes that peer's msg1 only when
 * the GET succeeds and the pk differs from the stored established link.
 */
export const PEER_MARKER_REFRESH_TTL_MS = 60_000;

export type LinkEnableFlow = {
  authorizationUrl: string;
  awaitEnabled: () => Promise<{ pubky: string; receiverPath: string; noisePublicKey: string }>;
  cancel: () => void;
};

export type LinkEnableStatus = "native-missing" | "needs-enable" | "session-offline" | "enabled";

interface LinkRetryPayload {
  type: typeof LINK_RETRY_PAYLOAD_TYPE;
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  senderPubky: PubkyKey;
  kind: string;
  eventId: string;
  rawJson: string;
  secretFingerprint?: string;
}

interface GroupFanoutRetryPayload {
  type: typeof LINK_GROUP_FANOUT_PAYLOAD_TYPE;
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  senderPubky: PubkyKey;
  kind: string;
  eventId: string;
  channelId: string;
  rawJson: string;
  secretFingerprint?: string;
}

type AnyLinkRetryPayload = LinkRetryPayload | GroupFanoutRetryPayload;

type ActiveSession = { handle: SessionHandle; pubky: string };
type LiveHandle =
  | { status: "established"; linkId: string }
  | { status: "handshaking"; linkId: string; role: LinkRole };
type SessionLookup = ActiveSession | { status: "offline" } | null;
type EnsureOutcome = LinkStatus | "idle" | "standby-blocked";

let session: ActiveSession | null = null;
let restoreInFlight: Promise<SessionLookup> | null = null;
const liveHandles = new Map<string, LiveHandle>();
const queues = new Map<string, Promise<unknown>>();
let drainTimer: ReturnType<typeof setInterval> | null = null;
const inboxSyncListeners = new Set<(ownerPubky: PubkyKey) => void>();
/** Serializes drain/recover loops. One wedged item cannot latch this: the
 * per-item budget detaches work and the loop continues. */
let drainPassChain: Promise<void> = Promise.resolve();
/**
 * In-flight claim on a queue item id → claim timestamp.
 * A second drain pass (or a send-path drain) cannot re-send or
 * double-`recordFailure` an item a first pass still holds. TTL lets a
 * wedged claim be stolen so one hung PUT cannot park the item forever.
 */
const drainItemClaims = new Map<string, number>();
const DRAIN_CLAIM_TTL_MS = 60_000;
const handshakeWatch = new Map<string, { polls: number; firstAt: number; snapshot: string }>();
const peerMarkerRefreshedAt = new Map<string, number>();
let takeoverInFlight: Promise<{
  pubky: string;
  receiverPath: string;
  noisePublicKey: string;
  receiverRole: "active" | "standby";
}> | null = null;

/** Same `ready` predicate the send path uses: live established handle or snapshot. */
export function isReadyLinkPredicate(
  record: { status: string; snapshot: string },
  live: LiveHandle | undefined,
): boolean {
  if (live?.status === "established") return true;
  return record.status === "established" && record.snapshot.length > 0;
}

export const LinkService = {
  async signinWithSecret(identitySecretHex: string): Promise<{ pubky: string }> {
    const handle = await PaykitLinkWeb.signinWithSecret(hexToBytes(identitySecretHex));
    const adopted = await adoptLiveHandle(handle);
    session = adopted;
    return { pubky: adopted.pubky };
  },

  async restorePersistedSession(): Promise<boolean> {
    try {
      await StorageService.retryPendingCleanup();
    } catch {
      // Cleanup journal is best-effort.
    }
    const lookup = await sessionOrRestore();
    return isActiveSession(lookup);
  },

  hasSession(): boolean {
    return currentSession() !== null;
  },

  async getEnableStatus(): Promise<LinkEnableStatus> {
    try {
      return await sessionEnableStatus();
    } catch (err) {
      if (isLinkNativeError(err) && err.code === "unavailable") return "native-missing";
      throw err;
    }
  },

  async clearSession(): Promise<void> {
    stopLinkRetryDrain();
    const owner = session?.pubky ?? (await KeyStore.getPubky());
    if (owner) {
      const links = await StorageService.getAllLinks(owner);
      for (const link of links) {
        const live = liveHandles.get(linkKey(owner, link.peerPubky));
        if (live) await closeQuietly(live.linkId);
      }
      const items = await StorageService.listDeliveryQueue();
      for (const item of items) {
        const payload = parseRetryPayload(item.payload);
        if (payload?.ownerPubky === owner) {
          await StorageService.removeFromQueue(item.id);
        }
      }
    }
    await signOut();
    session = null;
    liveHandles.clear();
    queues.clear();
  },

  async adoptHarnessSession(handle: SessionHandle): Promise<void> {
    const adopted = await adoptLiveHandle(handle);
    session = adopted;
  },

  async provisionReceiverForActiveSession(): Promise<{
    pubky: string;
    receiverPath: string;
    noisePublicKey: string;
  }> {
    const active = requireActiveSession();
    return provisionReceiver(active.handle, active.pubky);
  },

  async takeOverReceiver(): Promise<{
    pubky: string;
    receiverPath: string;
    noisePublicKey: string;
    receiverRole: "active" | "standby";
  }> {
    if (takeoverInFlight) return takeoverInFlight;
    takeoverInFlight = (async () => {
      const active = requireActiveSession();
      const result = await takeoverReceiver(active.handle, active.pubky);
      await restartQueuedUnestablishedHandshakes();
      return result;
    })().finally(() => {
      takeoverInFlight = null;
    });
    return takeoverInFlight;
  },

  async restartQueuedUnestablishedHandshakes(): Promise<void> {
    await restartQueuedUnestablishedHandshakes();
  },

  async establishedLinkId(peerPubky: PubkyKey): Promise<string> {
    const ownerPubky = await requireOwner();
    return requireEstablishedHandle(ownerPubky, peerPubky);
  },

  async enable(): Promise<LinkEnableFlow> {
    const flow = await PaykitLinkWeb.startAuthFlow(RING_GRANT_CAPABILITIES);
    let cancelled = false;
    return {
      authorizationUrl: flow.authorizationUrl(),
      cancel: () => {
        cancelled = true;
      },
      awaitEnabled: async () => {
        const handle = await PaykitLinkWeb.awaitAuthApproval(flow);
        if (cancelled) {
          try {
            await PaykitLinkWeb.signOutSession(handle);
          } catch {
            // Detached flow: drop the unused session.
          }
          throw new Error("LinkService.enable: the messaging enable flow was cancelled");
        }
        const adopted = await adoptApprovedSession(handle);
        session = adopted;
        return provisionReceiver(adopted.handle, adopted.pubky);
      },
    };
  },

  async putOwnerDocument(url: string, content: string): Promise<void> {
    const handle = requireSessionHandle();
    await PaykitLinkWeb.putPublic(
      handle,
      ownerDocumentPath(url),
      new TextEncoder().encode(content),
    );
  },

  async deleteOwnerDocument(url: string): Promise<void> {
    const handle = requireSessionHandle();
    await PaykitLinkWeb.deletePublic(handle, ownerDocumentPath(url));
  },

  async getLinkStatus(peerPubky: PubkyKey): Promise<LinkStatus | null> {
    const owner = session?.pubky ?? (await KeyStore.getPubky());
    if (!owner) return "needs-enable";
    try {
      const record = await StorageService.getLink(owner, peerPubky);
      if (!record) return null;
      const live = liveHandles.get(linkKey(owner, peerPubky));
      if (isReadyLinkPredicate(record, live)) return "ready";
      return record.role === "initiator" ? "handshaking-initiator" : "handshaking-responder";
    } catch {
      return "error";
    }
  },

  async ensureLinkWith(peerPubky: PubkyKey): Promise<LinkStatus> {
    return withQueue(peerPubky, async () => {
      try {
        const outcome = await ensureLinkLocked(peerPubky, true, false, "user");
        return outcome === "idle" || outcome === "standby-blocked" ? "error" : outcome;
      } catch (err) {
        if (isLinkNativeError(err) && err.code === "unavailable") return "native-missing";
        console.warn(`[LinkService] ensureLinkWith failed for ${peerPubky}:`, errorMessage(err));
        return "error";
      }
    });
  },

  async sendDm(peerPubky: PubkyKey, body: string): Promise<LinkMessage> {
    return withQueue(peerPubky, async () => {
      const outcome = await ensureLinkLocked(peerPubky, true, false, "user");
      assertLinkSendable(outcome, "sendDm");
      const ownerForRequest = await requireOwner();
      const pending = await StorageService.getMessageRequest(ownerForRequest, peerPubky);
      if (pending?.status === "pending") {
        await StorageService.upsertMessageRequest({
          ...pending,
          status: "accepted",
          updatedAt: Date.now(),
        });
      }

      const ownerPubky = await requireOwner();
      const { envelope, json } = buildChatMessageEnvelope({
        eventId: crypto.randomUUID(),
        sentAt: Date.now(),
        body,
      });
      return dispatchPreparedDm({
        ownerPubky,
        peerPubky,
        outcome,
        kind: CHAT_MESSAGE_KIND,
        eventId: envelope.event_id,
        rawJson: json,
        body: envelope.body,
        sentAt: envelope.sent_at,
      });
    });
  },

  async sendPreparedMessage(input: {
    peerPubky: PubkyKey;
    kind: string;
    eventId: string;
    rawJson: string;
    body: string;
    sentAt: number;
  }): Promise<LinkMessage> {
    return withQueue(input.peerPubky, async () => {
      const outcome = await ensureLinkLocked(input.peerPubky, true, false, "user");
      assertLinkSendable(outcome, "sendPreparedMessage");
      const ownerForRequest = await requireOwner();
      const pending = await StorageService.getMessageRequest(ownerForRequest, input.peerPubky);
      if (pending?.status === "pending") {
        await StorageService.upsertMessageRequest({
          ...pending,
          status: "accepted",
          updatedAt: Date.now(),
        });
      }
      return dispatchPreparedDm({
        ownerPubky: await requireOwner(),
        peerPubky: input.peerPubky,
        outcome,
        kind: input.kind,
        eventId: input.eventId,
        rawJson: input.rawJson,
        body: input.body,
        sentAt: input.sentAt,
      });
    });
  },

  async withPeerQueue<T>(peerPubky: PubkyKey, operation: () => Promise<T>): Promise<T> {
    return withQueue(peerPubky, operation);
  },

  async attemptPersistedSend(input: {
    peerPubky: PubkyKey;
    kind: string;
    eventId: string;
    queueId: string;
    rawJson: string;
  }): Promise<"sent" | "queued"> {
    return withQueue(input.peerPubky, async () => {
      let outcome: EnsureOutcome;
      try {
        outcome = await ensureLinkLocked(input.peerPubky, true, false, "auto");
      } catch {
        return "queued";
      }
      if (
        outcome !== "ready" &&
        outcome !== "handshaking-initiator" &&
        outcome !== "handshaking-responder"
      ) {
        return "queued";
      }
      const ownerForRequest = await requireOwner();
      const pending = await StorageService.getMessageRequest(ownerForRequest, input.peerPubky);
      if (pending?.status === "pending") {
        await StorageService.upsertMessageRequest({
          ...pending,
          status: "accepted",
          updatedAt: Date.now(),
        });
      }
      if (outcome !== "ready") return "queued";
      const queued = await StorageService.getDeliveryQueueItem(input.queueId);
      if (!queued) return "queued";
      const prior = await drainOwedSamePeerWritesLocked(input.peerPubky, { beforeItem: queued });
      if (prior !== "clear") return "queued";
      try {
        const ownerPubky = await requireOwner();
        const handle = requireEstablishedHandle(ownerPubky, input.peerPubky);
        const secretFingerprint = requireQueuedAttachmentFingerprint(queued.payload, input.kind);
        const wireJson = await wireJsonForNativeSend(
          input.kind,
          input.rawJson,
          ownerPubky,
          ownerPubky,
          input.eventId,
          secretFingerprint,
        );
        // R4-F2: re-scan just before the encrypt. The window since the entry
        // scan is only attachment reconstruction, but the re-scan is one
        // SELECT and does not re-acquire withQueue, so take it.
        const recheck = await drainOwedSamePeerWritesLocked(input.peerPubky, {
          beforeItem: queued,
        });
        if (recheck !== "clear") return "queued";
        const { snapshot } = await PaykitLinkWeb.sendPrivateMessageJson(handle, wireJson);
        await StorageService.finalizeLinkSend({
          ownerPubky,
          peerPubky: input.peerPubky,
          senderPubky: ownerPubky,
          kind: input.kind,
          eventId: input.eventId,
          snapshot,
          queueId: input.queueId,
        });
        return "sent";
      } catch (err) {
        console.warn(
          `[LinkService] Persisted send failed for ${input.peerPubky}:`,
          errorMessage(err),
        );
        return "queued";
      }
    });
  },

  async sendPersistedLinkJson(input: {
    peerPubky: PubkyKey;
    queueId: string;
    kind: string;
    eventId: string;
    rawJson: string;
    channelId: string;
  }): Promise<"sent" | "queued"> {
    return withQueue(input.peerPubky, async () => {
      let outcome: EnsureOutcome;
      try {
        outcome = await ensureLinkLocked(input.peerPubky, true, false, "auto");
      } catch {
        return "queued";
      }
      if (outcome !== "ready") return "queued";
      const queued = await StorageService.getDeliveryQueueItem(input.queueId);
      if (!queued) return "queued";
      const prior = await drainOwedSamePeerWritesLocked(input.peerPubky, { beforeItem: queued });
      if (prior !== "clear") return "queued";
      try {
        const ownerPubky = await requireOwner();
        const handle = requireEstablishedHandle(ownerPubky, input.peerPubky);
        const secretFingerprint = requireQueuedAttachmentFingerprint(queued.payload, input.kind);
        const wireJson = await wireJsonForNativeSend(
          input.kind,
          input.rawJson,
          ownerPubky,
          ownerPubky,
          input.eventId,
          secretFingerprint,
        );
        // R4-F2: re-scan just before the encrypt (same rationale as
        // attemptPersistedSend; fan-out shares the peer's nonce sequence).
        const recheck = await drainOwedSamePeerWritesLocked(input.peerPubky, {
          beforeItem: queued,
        });
        if (recheck !== "clear") return "queued";
        const { snapshot } = await PaykitLinkWeb.sendPrivateMessageJson(handle, wireJson);
        await StorageService.finalizeGroupFanoutSend({
          ownerPubky,
          peerPubky: input.peerPubky,
          snapshot,
          queueId: input.queueId,
        });
        return "sent";
      } catch (err) {
        console.warn(
          `[LinkService] Group fan-out send failed for ${input.peerPubky}:`,
          errorMessage(err),
        );
        return "queued";
      }
    });
  },

  async recoverPendingSends(): Promise<void> {
    await withDrainPass(async () => {
      try {
        await reconcilePaymentPendingSends();
        await reconcileLostOwedDeliveries();
      } catch (err) {
        console.warn("[LinkService] recoverPendingSends reconcile failed:", errorMessage(err));
      }
      let items: DeliveryQueueItem[] = [];
      try {
        items = await StorageService.listDeliveryQueue();
      } catch (err) {
        console.warn("[LinkService] recoverPendingSends list failed:", errorMessage(err));
        return;
      }
      await deliverQueueItemsOldestFirst(items, async (item, payload) => {
        if (payload.type === LINK_RETRY_PAYLOAD_TYPE) {
          const row = await StorageService.getLinkMessage(
            payload.ownerPubky,
            payload.senderPubky,
            payload.kind,
            payload.eventId,
          );
          if (!row || !isDeliveryOwed(row.deliveryState)) return;
        }
        await deliverQueuedPayloadWithBudget(item, payload);
      });
    });
  },

  async drainRetries(): Promise<void> {
    await withDrainPass(async () => {
      let due: DeliveryQueueItem[] = [];
      try {
        due = await RetryQueue.getDue();
      } catch (err) {
        console.warn("[LinkService] drainRetries getDue failed:", errorMessage(err));
        return;
      }
      await deliverQueueItemsOldestFirst(due, (item, payload) =>
        deliverQueuedPayloadWithBudget(item, payload),
      );
    });
  },

  async retryPendingSends(): Promise<void> {
    await LinkService.drainRetries();
  },

  async syncInbox(peers?: PubkyKey[]): Promise<LinkMessage[]> {
    const ownerPubky = await requireOwner();
    try {
      await syncOwnReceiverRole(ownerPubky);
    } catch {
      // Role sync must not block inbox.
    }
    const candidates = peers !== undefined ? peers : await collectInboxCandidates(ownerPubky);
    const received: LinkMessage[] = [];
    for (const peerPubky of new Set(candidates)) {
      try {
        const batch = await withQueue(peerPubky, () => syncPeerLocked(peerPubky));
        received.push(...batch);
      } catch (err) {
        console.warn(`[LinkService] Inbox sync failed for ${peerPubky}:`, errorMessage(err));
      }
    }
    try {
      await LinkService.drainRetries();
    } catch (err) {
      console.warn("[LinkService] drainRetries after syncInbox failed:", errorMessage(err));
    }
    notifyInboxSynced(ownerPubky);
    return received;
  },

  subscribeInboxSynced(listener: (ownerPubky: PubkyKey) => void): () => void {
    inboxSyncListeners.add(listener);
    return () => {
      inboxSyncListeners.delete(listener);
    };
  },

  async markRead(conversationId: string, readAt: number = Date.now()): Promise<void> {
    const owner = await KeyStore.getPubky();
    if (!owner) return;
    await StorageService.setLinkReadCursor(owner, conversationId, readAt);
  },

  async collectInboxCandidates(): Promise<PubkyKey[]> {
    return collectInboxCandidates(await requireOwner());
  },

  async acceptMessageRequest(peerPubky: PubkyKey): Promise<LinkMessage[]> {
    return withQueue(peerPubky, async () => {
      const ownerPubky = await requireOwner();
      const existing = await StorageService.getMessageRequest(ownerPubky, peerPubky);
      const ts = Date.now();
      await StorageService.upsertMessageRequest({
        ownerPubky,
        peerPubky,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
        status: "accepted",
      });
      return syncPeerLocked(peerPubky);
    });
  },

  async declineMessageRequest(peerPubky: PubkyKey): Promise<void> {
    return withQueue(peerPubky, async () => {
      const ownerPubky = await requireOwner();
      const stored = await StorageService.getLink(ownerPubky, peerPubky);
      if (stored) await wipeLinkState(stored);
      const orphanedFanout = await collectFanoutPayloadsForRecipient(peerPubky, ownerPubky);
      await StorageService.removeQueueItemsForRecipient(peerPubky, ownerPubky);
      await settleOrphanedFanout(orphanedFanout);
      await StorageService.deleteLinkStreamItemsForPeer(ownerPubky, peerPubky);
      await StorageService.deleteLinkMessagesForPeer(ownerPubky, peerPubky);
      const existing = await StorageService.getMessageRequest(ownerPubky, peerPubky);
      const ts = Date.now();
      await StorageService.upsertMessageRequest({
        ownerPubky,
        peerPubky,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
        status: "declined",
      });
    });
  },

  /**
   * Wipe and re-key the Encrypted Link to `peerPubky` without deleting
   * conversation history. Drops parked/owed queue items for that peer so a
   * permanently failing link is not bricked forever. The next send/ensure
   * starts a new handshake (new nonce sequence).
   *
   * Reset means "stop trying" (R4-F4): the peer's owed outbound DM rows are
   * marked terminally `failed` so the lost-item heal (which only re-enqueues
   * `sending` rows) does not re-send owed history under the new link. Group
   * fan-out states for this recipient are settled the same way: with the
   * queue items gone, a group row whose last owed recipient was this peer is
   * marked failed instead of sitting in `sending` forever. Queue drop and
   * abandon run in one SQL transaction so a crash cannot leave `sending`
   * rows with no queue item for the heal to resurrect under the new link.
   */
  async resetEncryptedLink(peerPubky: PubkyKey): Promise<void> {
    return withQueue(peerPubky, async () => {
      const ownerPubky = await requireOwner();
      const stored = await StorageService.getLink(ownerPubky, peerPubky);
      if (stored) await wipeLinkState(stored);
      const orphanedFanout = await collectFanoutPayloadsForRecipient(peerPubky, ownerPubky);
      await StorageService.removeQueueItemsAndAbandonOwedForPeer(ownerPubky, peerPubky);
      await settleOrphanedFanout(orphanedFanout);
    });
  },
};

export function startLinkRetryDrain(intervalMs = LINK_RETRY_DRAIN_INTERVAL_MS): () => void {
  stopLinkRetryDrain();
  drainTimer = setInterval(() => {
    void LinkService.drainRetries().catch((err) => {
      console.warn("[LinkService] drainRetries failed:", errorMessage(err));
    });
  }, intervalMs);
  return stopLinkRetryDrain;
}

export function stopLinkRetryDrain(): void {
  if (drainTimer) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
}

/**
 * Visibility + interval drain. Full UI poll is P6; this keeps the nonce-safe
 * queue moving while the tab is visible.
 */
export function startLinkRetryDrainOnVisibility(
  intervalMs = LINK_RETRY_DRAIN_INTERVAL_MS,
): () => void {
  const stopInterval = startLinkRetryDrain(intervalMs);
  const onVis = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      void LinkService.recoverPendingSends().catch((err) => {
        console.warn("[LinkService] recoverPendingSends failed:", errorMessage(err));
      });
      void LinkService.drainRetries().catch((err) => {
        console.warn("[LinkService] drainRetries failed:", errorMessage(err));
      });
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVis);
  }
  onVis();
  return () => {
    stopInterval();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVis);
    }
  };
}

export function linkQueueEntryCountForTests(): number {
  return queues.size;
}

export function resetLinkServiceHarnessState(): void {
  session = null;
  liveHandles.clear();
  queues.clear();
  drainItemClaims.clear();
  handshakeWatch.clear();
  peerMarkerRefreshedAt.clear();
  drainPassChain = Promise.resolve();
  takeoverInFlight = null;
}

function currentSession(): ActiveSession | null {
  if (session) return session;
  const live = getLiveSession();
  if (live) {
    session = live;
    return session;
  }
  return null;
}

function requireActiveSession(): ActiveSession {
  const active = currentSession();
  if (!active) throw new Error("LinkService: no live session");
  return active;
}

async function sessionOrRestore(): Promise<SessionLookup> {
  const current = currentSession();
  if (current) return current;
  restoreInFlight ??= restoreFromSessionStore();
  try {
    return await restoreInFlight;
  } finally {
    restoreInFlight = null;
  }
}

async function restoreFromSessionStore(): Promise<SessionLookup> {
  const restore = await restoreSessionOnLoad();
  if (restore.status === "live") {
    session = { handle: restore.handle, pubky: restore.pubky };
    return session;
  }
  if (restore.status === "session-offline") return { status: "offline" };
  return null;
}

function isActiveSession(lookup: SessionLookup): lookup is ActiveSession {
  return lookup !== null && !("status" in lookup);
}

async function ensureLinkLocked(
  peerPubky: PubkyKey,
  allowInitiate: boolean,
  alreadyRecovered: boolean,
  intent: HandshakeIntent,
): Promise<EnsureOutcome> {
  const lookup = await sessionOrRestore();
  if (lookup && "status" in lookup && lookup.status === "offline") return "session-offline";
  if (!isActiveSession(lookup)) return "needs-enable";
  const activeSession = lookup;
  const ownerPubky = activeSession.pubky;
  const receiver = await StorageService.getLinkReceiver(ownerPubky);
  if (!receiver) return "needs-enable";
  const localPath = assertValidReceiverPath(coerceReceiverPath(receiver.receiverPath));

  const key = linkKey(ownerPubky, peerPubky);
  let live = liveHandles.get(key);
  let stored = await StorageService.getLink(ownerPubky, peerPubky);

  if (allowInitiate && intent === "user") {
    await StorageService.clearHandshakeBudget(ownerPubky, peerPubky);
  }

  if (stored && (await shouldAgeOutNonReadyLink(stored))) {
    await wipeLinkState(stored);
    stored = null;
    live = liveHandles.get(key);
  }

  if (live?.status === "established" || stored?.status === "established") {
    if (stored?.status === "established" && live?.status !== "established") {
      const restored = await restoreEstablished(
        activeSession,
        receiver,
        stored,
        alreadyRecovered,
        allowInitiate,
        intent,
      );
      if (restored !== "ready") return restored;
      live = liveHandles.get(key);
    }
    if (stored?.status === "established") {
      const rekeyed = await maybeAdoptEstablishedRekey(
        activeSession,
        receiver,
        stored,
        ownerPubky,
        peerPubky,
        localPath,
      );
      if (rekeyed !== null) return rekeyed;
    }
    if (liveHandles.get(key)?.status === "established" || stored?.status === "established") {
      return "ready";
    }
  }

  // Standby: this device's published marker is not live (foreign or orphan).
  // Established links already returned above. Cover any non-ready row
  // (none, handshaking, zombie established that failed restore) so sends
  // cannot persist+queue against a dead published key.
  const latestReceiver = await StorageService.getLinkReceiver(ownerPubky);
  if (latestReceiver?.receiverRole === "standby") {
    return "standby-blocked";
  }

  if (intent !== "user" && (await isHandshakeBudgetExhausted(ownerPubky, peerPubky))) {
    return "error";
  }

  let marker: ReceiverMarker | null | undefined;
  try {
    marker = await PaykitLinkWeb.getReceiverMarker(peerPubky, localPath);
    if (marker) {
      if (stored) {
        await StorageService.recordLastSeenPeerMarkerPk(
          ownerPubky,
          peerPubky,
          marker.noisePublicKey,
        );
        stored = { ...stored, lastSeenPeerMarkerPk: marker.noisePublicKey };
      }
    }
  } catch {
    marker = undefined;
  }

  if (marker) {
    let inbound: Extract<LinkProbeResult, { result: "pending" | "established" }> | null = null;
    try {
      inbound = await probeInbound(activeSession, receiver, ownerPubky, peerPubky, marker, localPath);
    } catch (err) {
      if (isLinkNativeError(err) && err.code === "protocol") {
        await clearPeerOutboxBestEffort(
          activeSession,
          receiver,
          peerPubky,
          marker.noisePublicKey,
          localPath,
          LINK_RECEIVER_PATH,
        );
        inbound = null;
      } else {
        throw err;
      }
    }
    if (inbound !== null) {
      const replaceable = stored === null || stored.status !== "established";
      if (replaceable && (stored?.status === "handshaking" || live?.status === "handshaking")) {
        if (stored) await wipeNonReadyHandshakeOnly(stored);
        else if (live) {
          await closeQuietly(live.linkId);
          liveHandles.delete(key);
        }
      }
      if (replaceable) {
        return adoptInboundHandshake(ownerPubky, peerPubky, marker, localPath, inbound);
      }
    }
  }

  live = liveHandles.get(key);
  stored = await StorageService.getLink(ownerPubky, peerPubky);

  if (live?.status === "handshaking") {
    return advanceLiveHandshake(
      activeSession,
      receiver,
      ownerPubky,
      peerPubky,
      live,
      alreadyRecovered,
      allowInitiate,
      intent,
    );
  }

  if (stored?.status === "handshaking") {
    return restoreAndAdvanceHandshake(
      activeSession,
      receiver,
      stored,
      alreadyRecovered,
      allowInitiate,
      intent,
    );
  }

  if (marker === undefined) {
    live = liveHandles.get(key);
    stored = await StorageService.getLink(ownerPubky, peerPubky);
    if (live?.status === "handshaking") {
      return advanceLiveHandshake(
        activeSession,
        receiver,
        ownerPubky,
        peerPubky,
        live,
        alreadyRecovered,
        allowInitiate,
        intent,
      );
    }
    if (stored?.status === "handshaking") {
      return restoreAndAdvanceHandshake(
        activeSession,
        receiver,
        stored,
        alreadyRecovered,
        allowInitiate,
        intent,
      );
    }
    return "idle";
  }
  if (!marker) return allowInitiate ? "not-enrolled" : "idle";
  if (!allowInitiate) return "idle";

  return initiateHandshake(
    activeSession,
    receiver,
    ownerPubky,
    peerPubky,
    marker,
    localPath,
    alreadyRecovered,
    allowInitiate,
    intent,
  );
}

function recordedEstablishedPeerPk(stored: LinkRecord): string {
  return stored.lastSeenPeerMarkerPk || stored.remoteNoisePublicKey || "";
}

function peerMarkerRefreshDue(ownerPubky: PubkyKey, peerPubky: PubkyKey): boolean {
  const last = peerMarkerRefreshedAt.get(linkKey(ownerPubky, peerPubky));
  if (last === undefined) return true;
  return Date.now() - last >= PEER_MARKER_REFRESH_TTL_MS;
}

function markPeerMarkerRefreshed(ownerPubky: PubkyKey, peerPubky: PubkyKey): void {
  peerMarkerRefreshedAt.set(linkKey(ownerPubky, peerPubky), Date.now());
}

async function inboundStillAllowed(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<boolean> {
  const existing = await StorageService.getMessageRequest(ownerPubky, peerPubky);
  return existing?.status !== "declined";
}

/**
 * Responder re-key: an established link is kept unless a fresh GET shows the
 * peer's published marker pk changed AND a new msg1 decrypts under our current
 * receiver secret against that new pk. Junk / undecryptable msg1 leaves the
 * established link in place (an attacker cannot force a drop).
 */
async function maybeAdoptEstablishedRekey(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  stored: LinkRecord,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  localPath: string,
): Promise<EnsureOutcome | null> {
  if (!peerMarkerRefreshDue(ownerPubky, peerPubky)) return null;

  let marker: ReceiverMarker | null | undefined;
  try {
    marker = await PaykitLinkWeb.getReceiverMarker(peerPubky, localPath);
  } catch {
    markPeerMarkerRefreshed(ownerPubky, peerPubky);
    return null;
  }
  markPeerMarkerRefreshed(ownerPubky, peerPubky);
  if (!marker) return null;

  const recorded = recordedEstablishedPeerPk(stored);
  if (!recorded || marker.noisePublicKey === recorded) {
    await StorageService.recordLastSeenPeerMarkerPk(ownerPubky, peerPubky, marker.noisePublicKey);
    return null;
  }

  if (!(await inboundStillAllowed(ownerPubky, peerPubky))) return null;

  let inbound: Extract<LinkProbeResult, { result: "pending" | "established" }> | null;
  try {
    inbound = await probeInbound(activeSession, receiver, ownerPubky, peerPubky, marker, localPath);
  } catch (err) {
    if (isLinkNativeError(err) && err.code === "protocol") return null;
    throw err;
  }
  if (inbound === null) return null;

  await archiveEstablishedLink(stored);
  return adoptInboundHandshake(ownerPubky, peerPubky, marker, localPath, inbound);
}

async function archiveEstablishedLink(stored: LinkRecord): Promise<void> {
  const key = linkKey(stored.ownerPubky, stored.peerPubky);
  const live = liveHandles.get(key);
  if (live) {
    await closeQuietly(live.linkId);
    liveHandles.delete(key);
  }
  await StorageService.upsertLink({
    ownerPubky: stored.ownerPubky,
    peerPubky: stored.peerPubky,
    role: stored.role,
    status: "superseded",
    snapshot: stored.snapshot,
    remoteNoisePublicKey: stored.remoteNoisePublicKey,
    localReceiverPath: stored.localReceiverPath,
    remoteReceiverPath: stored.remoteReceiverPath,
    consecutiveFailures: stored.consecutiveFailures,
    lastSeenPeerMarkerPk: stored.lastSeenPeerMarkerPk ?? stored.remoteNoisePublicKey,
  });
}

async function restoreEstablished(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  stored: LinkRecord,
  alreadyRecovered: boolean,
  allowInitiate: boolean,
  intent: HandshakeIntent,
): Promise<EnsureOutcome> {
  const localPath = coerceReceiverPath(stored.localReceiverPath);
  const remotePath = coerceReceiverPath(stored.remoteReceiverPath);
  try {
    const { linkId } = await PaykitLinkWeb.restoreLink(
      activeSession.handle,
      receiver.receiverAlias,
      stored.peerPubky,
      stored.remoteNoisePublicKey,
      localPath,
      remotePath,
      stored.snapshot,
    );
    liveHandles.set(linkKey(stored.ownerPubky, stored.peerPubky), {
      status: "established",
      linkId,
    });
    await StorageService.resetLinkConsecutiveFailures(stored.ownerPubky, stored.peerPubky);
    return "ready";
  } catch (err) {
    return handleLinkFailure(err, stored, alreadyRecovered, allowInitiate, intent);
  }
}

async function restoreAndAdvanceHandshake(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  stored: LinkRecord,
  alreadyRecovered: boolean,
  allowInitiate: boolean,
  intent: HandshakeIntent,
): Promise<EnsureOutcome> {
  const localPath = coerceReceiverPath(stored.localReceiverPath);
  const remotePath = coerceReceiverPath(stored.remoteReceiverPath);
  try {
    const restored = await PaykitLinkWeb.restoreHandshake(
      activeSession.handle,
      receiver.receiverAlias,
      stored.peerPubky,
      stored.remoteNoisePublicKey,
      localPath,
      remotePath,
      stored.snapshot,
    );
    liveHandles.set(linkKey(stored.ownerPubky, stored.peerPubky), {
      status: "handshaking",
      linkId: restored.linkId,
      role: stored.role,
    });
    if (restored.status === "established") {
      return completeEstablished(
        activeSession,
        receiver,
        stored.ownerPubky,
        stored.peerPubky,
        stored.role,
        stored.snapshot,
        stored.remoteNoisePublicKey,
        localPath,
        remotePath,
        restored.linkId,
      );
    }
    return advanceLiveHandshake(
      activeSession,
      receiver,
      stored.ownerPubky,
      stored.peerPubky,
      { status: "handshaking", linkId: restored.linkId, role: stored.role },
      alreadyRecovered,
      allowInitiate,
      intent,
    );
  } catch (err) {
    return handleLinkFailure(err, stored, alreadyRecovered, allowInitiate, intent);
  }
}

async function advanceLiveHandshake(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  live: Extract<LiveHandle, { status: "handshaking" }>,
  alreadyRecovered: boolean,
  allowInitiate: boolean,
  intent: HandshakeIntent,
): Promise<EnsureOutcome> {
  const stored = await StorageService.getLink(ownerPubky, peerPubky);
  try {
    const result = await PaykitLinkWeb.advanceHandshake(live.linkId);
    if (result.status === "established") {
      const remoteKey = stored?.remoteNoisePublicKey ?? "";
      const localPath = coerceReceiverPath(stored?.localReceiverPath ?? receiver.receiverPath);
      const remotePath = coerceReceiverPath(stored?.remoteReceiverPath ?? LINK_RECEIVER_PATH);
      return completeEstablished(
        activeSession,
        receiver,
        ownerPubky,
        peerPubky,
        live.role,
        result.snapshot,
        remoteKey,
        localPath,
        remotePath,
        live.linkId,
      );
    }

    await StorageService.updateLinkSnapshot(ownerPubky, peerPubky, result.snapshot, "handshaking");

    if (live.role === "initiator") {
      const recovered = await maybeRecoverInitiatorMarkerRotation(
        activeSession,
        receiver,
        ownerPubky,
        peerPubky,
        live,
        stored,
        result.snapshot,
        alreadyRecovered,
        allowInitiate,
        intent,
      );
      if (recovered !== null) return recovered;
    }

    if (live.role === "initiator" && ownerPubky < peerPubky) {
      const marker = await PaykitLinkWeb.getReceiverMarker(peerPubky, LINK_RECEIVER_PATH);
      if (marker) {
        const inbound = await probeInbound(
          activeSession,
          receiver,
          ownerPubky,
          peerPubky,
          marker,
          LINK_RECEIVER_PATH,
        );
        if (inbound !== null) {
          await closeQuietly(live.linkId);
          liveHandles.delete(linkKey(ownerPubky, peerPubky));
          return adoptInboundHandshake(ownerPubky, peerPubky, marker, LINK_RECEIVER_PATH, inbound);
        }
      }
    }

    return roleStatus(live.role);
  } catch (err) {
    const fallback: LinkRecord = stored ?? {
      ownerPubky,
      peerPubky,
      role: live.role,
      status: "handshaking",
      snapshot: "",
      remoteNoisePublicKey: "",
      localReceiverPath: receiver.receiverPath,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
      lastSeenPeerMarkerPk: null,
      updatedAt: Date.now(),
    };
    return handleLinkFailure(err, fallback, alreadyRecovered, allowInitiate, intent);
  }
}

async function completeEstablished(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  role: LinkRole,
  snapshot: string,
  remoteNoisePublicKey: string,
  localPath: string,
  remotePath: string,
  handshakeLinkId: string,
): Promise<LinkStatus> {
  await StorageService.clearHandshakeBudget(ownerPubky, peerPubky);
  handshakeWatch.delete(linkKey(ownerPubky, peerPubky));
  await StorageService.upsertLink({
    ownerPubky,
    peerPubky,
    role,
    status: "established",
    snapshot,
    remoteNoisePublicKey,
    localReceiverPath: localPath,
    remoteReceiverPath: remotePath,
    consecutiveFailures: 0,
  });
  await closeQuietly(handshakeLinkId);
  const { linkId } = await PaykitLinkWeb.restoreLink(
    activeSession.handle,
    receiver.receiverAlias,
    peerPubky,
    remoteNoisePublicKey,
    localPath,
    remotePath,
    snapshot,
  );
  liveHandles.set(linkKey(ownerPubky, peerPubky), { status: "established", linkId });
  return "ready";
}

async function initiateHandshake(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  localPath: string,
  alreadyRecovered: boolean,
  allowInitiate: boolean,
  intent: HandshakeIntent,
): Promise<EnsureOutcome> {
  if (receiver.receiverRole === "standby") return "standby-blocked";
  const remotePath = LINK_RECEIVER_PATH;
  const initiated = await PaykitLinkWeb.initiateLink(
    activeSession.handle,
    receiver.receiverAlias,
    peerPubky,
    marker.noisePublicKey,
    localPath,
    remotePath,
  );
  await StorageService.upsertLink({
    ownerPubky,
    peerPubky,
    role: "initiator",
    status: "handshaking",
    snapshot: initiated.snapshot,
    remoteNoisePublicKey: marker.noisePublicKey,
    localReceiverPath: localPath,
    remoteReceiverPath: remotePath,
    consecutiveFailures: 0,
    lastSeenPeerMarkerPk: marker.noisePublicKey,
  });
  liveHandles.set(linkKey(ownerPubky, peerPubky), {
    status: "handshaking",
    linkId: initiated.linkId,
    role: "initiator",
  });
  return advanceLiveHandshake(
    activeSession,
    receiver,
    ownerPubky,
    peerPubky,
    { status: "handshaking", linkId: initiated.linkId, role: "initiator" },
    alreadyRecovered,
    allowInitiate,
    intent,
  );
}

async function probeInbound(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  _ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  localPath: string,
): Promise<Extract<LinkProbeResult, { result: "pending" | "established" }> | null> {
  try {
    const probed = await PaykitLinkWeb.probeInboundLink(
      activeSession.handle,
      receiver.receiverAlias,
      peerPubky,
      marker.noisePublicKey,
      localPath,
      LINK_RECEIVER_PATH,
    );
    if (probed.result === "none") return null;
    return probed;
  } catch (err) {
    if (isLinkNativeError(err) && err.code === "protocol") throw err;
    return null;
  }
}

async function adoptInboundHandshake(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  localPath: string,
  inbound: Extract<LinkProbeResult, { result: "pending" | "established" }>,
): Promise<LinkStatus> {
  const remotePath = LINK_RECEIVER_PATH;
  const key = linkKey(ownerPubky, peerPubky);
  if (inbound.result === "established") {
    await StorageService.clearHandshakeBudget(ownerPubky, peerPubky);
    handshakeWatch.delete(key);
    await StorageService.upsertLink({
      ownerPubky,
      peerPubky,
      role: "responder",
      status: "established",
      snapshot: inbound.snapshot,
      remoteNoisePublicKey: marker.noisePublicKey,
      localReceiverPath: localPath,
      remoteReceiverPath: remotePath,
      consecutiveFailures: 0,
      lastSeenPeerMarkerPk: marker.noisePublicKey,
    });
    liveHandles.set(key, { status: "established", linkId: inbound.linkId });
    return "ready";
  }

  await StorageService.upsertLink({
    ownerPubky,
    peerPubky,
    role: "responder",
    status: "handshaking",
    snapshot: inbound.snapshot,
    remoteNoisePublicKey: marker.noisePublicKey,
    localReceiverPath: localPath,
    remoteReceiverPath: remotePath,
    consecutiveFailures: 0,
    lastSeenPeerMarkerPk: marker.noisePublicKey,
  });
  liveHandles.set(key, { status: "handshaking", linkId: inbound.linkId, role: "responder" });
  return "handshaking-responder";
}

async function handleLinkFailure(
  err: unknown,
  stored: LinkRecord,
  alreadyRecovered: boolean,
  allowInitiate: boolean,
  intent: HandshakeIntent,
): Promise<EnsureOutcome> {
  if (isLinkNativeError(err) && err.code === "unavailable") return "native-missing";
  if (isLinkNativeError(err) && err.code === "auth") {
    session = null;
    return "needs-enable";
  }
  const established = stored.status === "established";
  if (isLinkNativeError(err) && err.code === "network") {
    if (established) {
      console.warn(
        `[LinkService] Established link restore deferred for ${stored.peerPubky}:`,
        errorMessage(err),
      );
      return "ready";
    }
    const failures = await StorageService.incrementLinkConsecutiveFailures(
      stored.ownerPubky,
      stored.peerPubky,
    );
    if (failures >= HANDSHAKE_FAILURE_LIMIT) {
      return recoverWedgedLink(stored, alreadyRecovered, allowInitiate, intent, err);
    }
    return roleStatus(stored.role);
  }
  if (isLinkNativeError(err) && err.code === "protocol") {
    return recoverWedgedLink(stored, alreadyRecovered, allowInitiate, intent, err);
  }

  if (established) {
    console.warn(
      `[LinkService] Established link step failed for ${stored.peerPubky}:`,
      errorMessage(err),
    );
    return "ready";
  }

  const failures = await StorageService.incrementLinkConsecutiveFailures(
    stored.ownerPubky,
    stored.peerPubky,
  );
  if (failures >= HANDSHAKE_FAILURE_LIMIT) {
    return recoverWedgedLink(stored, alreadyRecovered, allowInitiate, intent, err);
  }
  console.warn(`[LinkService] Handshake step failed for ${stored.peerPubky}:`, errorMessage(err));
  return roleStatus(stored.role);
}

async function recoverWedgedLink(
  stored: LinkRecord,
  alreadyRecovered: boolean,
  allowInitiate: boolean,
  intent: HandshakeIntent,
  cause: unknown,
): Promise<EnsureOutcome> {
  const protocol = isLinkNativeError(cause) && cause.code === "protocol";
  if (protocol) {
    try {
      const marker = await PaykitLinkWeb.getReceiverMarker(stored.peerPubky, LINK_RECEIVER_PATH);
      if (
        marker &&
        stored.remoteNoisePublicKey &&
        marker.noisePublicKey !== stored.remoteNoisePublicKey
      ) {
        console.warn(
          `[LinkService] Peer ${stored.peerPubky} re-enrolled (noise key changed); restarting handshake`,
        );
      }
    } catch {
      // Marker fetch failing does not block the wipe.
    }
  }

  if (stored.status !== "established") {
    const budget = await chargeHandshakeBudget(stored.ownerPubky, stored.peerPubky);
    if (budget.exhausted) return abandonUnestablishedLink(stored);
  }

  await wipeLinkState(stored);

  if (alreadyRecovered) return "error";
  return ensureLinkLocked(stored.peerPubky, allowInitiate, true, intent);
}

async function chargeHandshakeBudget(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
): Promise<{ advances: number; exhausted: boolean }> {
  const current = await StorageService.getHandshakeBudget(ownerPubky, peerPubky);
  const held = {
    advances: current?.pendingAdvances ?? 0,
    exhausted: current ? current.exhaustedAt !== null : false,
  };
  const advances = held.advances + 1;
  const exhausted = advances >= HANDSHAKE_PENDING_ADVANCE_LIMIT;
  await StorageService.upsertHandshakeBudget({
    ownerPubky,
    peerPubky,
    pendingAdvances: advances,
    nextAdvanceAt: nextAttemptAt(advances),
    exhaustedAt: exhausted ? (current?.exhaustedAt ?? Date.now()) : null,
  });
  return { advances, exhausted };
}

async function isHandshakeBudgetExhausted(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
): Promise<boolean> {
  const budget = await StorageService.getHandshakeBudget(ownerPubky, peerPubky);
  return !!budget && budget.exhaustedAt !== null;
}

async function abandonUnestablishedLink(stored: LinkRecord): Promise<EnsureOutcome> {
  handshakeWatch.delete(linkKey(stored.ownerPubky, stored.peerPubky));
  await StorageService.abandonOwedLinkMessagesForPeer(stored.ownerPubky, stored.peerPubky);
  await wipeLinkState(stored);
  return "error";
}

async function shouldAgeOutNonReadyLink(stored: LinkRecord): Promise<boolean> {
  const ageMs = Date.now() - stored.updatedAt;
  if (!Number.isFinite(ageMs) || ageMs < HANDSHAKE_STALE_MS) return false;
  if (stored.status === "handshaking") {
    const budget = await StorageService.getHandshakeBudget(stored.ownerPubky, stored.peerPubky);
    if (budget && budget.exhaustedAt === null && budget.pendingAdvances > 0) return false;
    return true;
  }
  return false;
}

async function wipeNonReadyHandshakeOnly(stored: LinkRecord): Promise<void> {
  if (stored.status === "established") return;
  await wipeLinkState(stored);
}

async function maybeRecoverInitiatorMarkerRotation(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  live: Extract<LiveHandle, { status: "handshaking" }>,
  stored: LinkRecord | null,
  snapshot: string,
  alreadyRecovered: boolean,
  allowInitiate: boolean,
  intent: HandshakeIntent,
): Promise<EnsureOutcome | null> {
  const key = linkKey(ownerPubky, peerPubky);
  const watch = handshakeWatch.get(key);
  const now = Date.now();
  if (!watch || watch.snapshot !== snapshot) {
    handshakeWatch.set(key, { polls: 1, firstAt: now, snapshot });
  } else {
    handshakeWatch.set(key, { polls: watch.polls + 1, firstAt: watch.firstAt, snapshot });
  }
  const current = handshakeWatch.get(key)!;
  const due =
    current.polls >= MARKER_RECOVERY_POLL_LIMIT ||
    now - current.firstAt >= MARKER_RECOVERY_TIMEOUT_MS;
  if (!due) return null;

  let marker: ReceiverMarker | null;
  try {
    marker = await PaykitLinkWeb.getReceiverMarker(peerPubky, LINK_RECEIVER_PATH);
  } catch {
    return null;
  }
  const recorded = stored?.remoteNoisePublicKey ?? stored?.lastSeenPeerMarkerPk ?? "";
  if (!marker || !recorded || marker.noisePublicKey === recorded) {
    handshakeWatch.set(key, { polls: 0, firstAt: now, snapshot });
    return null;
  }

  const row =
    stored ??
    ({
      ownerPubky,
      peerPubky,
      role: "initiator" as const,
      status: "handshaking" as const,
      snapshot,
      remoteNoisePublicKey: recorded,
      localReceiverPath: receiver.receiverPath,
      remoteReceiverPath: LINK_RECEIVER_PATH,
      consecutiveFailures: 0,
      lastSeenPeerMarkerPk: recorded,
      updatedAt: now,
    } satisfies LinkRecord);

  const budget = await chargeHandshakeBudget(ownerPubky, peerPubky);
  if (budget.exhausted) return abandonUnestablishedLink(row);

  await wipeLinkState(row);
  handshakeWatch.delete(key);
  if (alreadyRecovered) return "error";
  return initiateHandshake(
    activeSession,
    receiver,
    ownerPubky,
    peerPubky,
    marker,
    coerceReceiverPath(receiver.receiverPath),
    true,
    allowInitiate,
    intent,
  );
}

async function wipeLinkState(stored: LinkRecord): Promise<void> {
  const key = linkKey(stored.ownerPubky, stored.peerPubky);
  const live = liveHandles.get(key);
  if (live) {
    await closeQuietly(live.linkId);
    liveHandles.delete(key);
  }
  const receiver = await StorageService.getLinkReceiver(stored.ownerPubky);
  if (session && receiver) {
    try {
      await PaykitLinkWeb.clearLinkOutbox(
        session.handle,
        receiver.receiverAlias,
        stored.peerPubky,
        stored.remoteNoisePublicKey,
        coerceReceiverPath(stored.localReceiverPath),
        coerceReceiverPath(stored.remoteReceiverPath),
      );
    } catch {
      // Best-effort.
    }
  }
  await StorageService.deleteLink(stored.ownerPubky, stored.peerPubky);
}

function assertLinkSendable(
  outcome: EnsureOutcome,
  operation: "sendDm" | "sendPreparedMessage",
): void {
  if (
    outcome === "ready" ||
    outcome === "handshaking-initiator" ||
    outcome === "handshaking-responder"
  ) {
    return;
  }
  if (outcome === "standby-blocked") {
    throw new LinkSendError("standby-not-receiving", STANDBY_COMPOSER_NOTICE);
  }
  throw new LinkSendError(
    "not-sendable",
    `LinkService.${operation}: cannot send — link status is '${outcome}'`,
  );
}

/**
 * After this device takes over the receiver marker, in-flight initiator
 * handshakes that targeted the previous (dead) published key cannot complete:
 * the peer already answered msg1 against that key. Wipe unestablished rows
 * and re-initiate. Takeover is explicit user intent: clear any exhausted
 * budget first so a long-standby peer is recovered rather than abandoned
 * (queued sends stay queued). Re-initiate with `user` intent so the
 * follow-up does not re-charge.
 */
async function restartQueuedUnestablishedHandshakes(): Promise<void> {
  const ownerPubky = await requireOwner();
  const links = await StorageService.getAllLinks(ownerPubky);
  for (const link of links) {
    if (link.status === "established") continue;
    await withQueue(link.peerPubky, async () => {
      const current = await StorageService.getLink(ownerPubky, link.peerPubky);
      if (!current || current.status === "established") return;
      await StorageService.clearHandshakeBudget(ownerPubky, current.peerPubky);
      await wipeLinkState(current);
      await ensureLinkLocked(current.peerPubky, true, true, "user");
    });
  }
}

async function collectInboxCandidates(ownerPubky: PubkyKey): Promise<PubkyKey[]> {
  const [contacts, links] = await Promise.all([
    StorageService.getAllContacts(ownerPubky),
    StorageService.getAllLinks(ownerPubky),
  ]);
  const seen = new Set<string>();
  const out: PubkyKey[] = [];
  for (const contact of contacts) {
    if (seen.has(contact.pubky)) continue;
    seen.add(contact.pubky);
    out.push(contact.pubky);
  }
  for (const link of links) {
    if (seen.has(link.peerPubky)) continue;
    seen.add(link.peerPubky);
    out.push(link.peerPubky);
  }
  return out;
}

async function persistInboundWithoutRouting(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
): Promise<void> {
  const handle = requireEstablishedHandle(ownerPubky, peerPubky);
  const { messages, snapshot } = await PaykitLinkWeb.receivePrivateMessages(handle);
  if (messages.length === 0) return;
  const arrivedAt = Date.now();
  const streamItems = await prepareInboundStreamItems(ownerPubky, peerPubky, messages, arrivedAt);
  if (streamItems.length > 0) {
    await StorageService.saveLinkStreamItems(streamItems);
  }
  await StorageService.updateLinkSnapshot(ownerPubky, peerPubky, snapshot, "established");
  await routeHeldGroupInbound(ownerPubky, peerPubky);
}

async function routeHeldGroupInbound(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
  const items = await StorageService.getUnprocessedLinkStreamItems(ownerPubky, peerPubky);
  for (const item of items) {
    if (shouldDropOversizedKnownInbound(item.rawJson, item.kind)) {
      const peekedOver = peekEnvelopeKind(item.rawJson);
      if (peekedOver !== null && isGroupWireKind(peekedOver)) {
        const groupEnvelope = decodeGroupEnvelope(item.rawJson);
        if (groupEnvelope) {
          await StorageService.markGroupEventSeen(
            ownerPubky,
            groupEnvelope.channel_id,
            peerPubky,
            groupEnvelope.event_id,
            item.receivedAt,
          );
        }
      }
      await StorageService.markLinkStreamItemProcessed(item.id);
      continue;
    }
    const peeked = peekEnvelopeKind(item.rawJson);
    if (peeked === null || !isGroupWireKind(peeked)) continue;
    const groupEnvelope = decodeGroupEnvelope(item.rawJson);
    if (!groupEnvelope) {
      await StorageService.markLinkStreamItemProcessed(item.id);
    }
    // Leave valid group envelopes unprocessed. Applying here would
    // materialize attacker-chosen names and bodies before WoT accept.
  }
}

async function holdAsMessageRequest(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
  const existing = await StorageService.getMessageRequest(ownerPubky, peerPubky);
  if (existing?.status === "declined") return;
  const ts = Date.now();
  await StorageService.upsertMessageRequest({
    ownerPubky,
    peerPubky,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
    status: "pending",
  });
}

async function rejectDeclinedInbound(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<void> {
  const key = linkKey(ownerPubky, peerPubky);
  const live = liveHandles.get(key);
  if (live) {
    await closeQuietly(live.linkId);
    liveHandles.delete(key);
  }
  const leftover = await StorageService.getLink(ownerPubky, peerPubky);
  if (leftover) {
    await wipeLinkState(leftover);
    return;
  }
  const lookup = await sessionOrRestore();
  if (!isActiveSession(lookup)) return;
  const receiver = await StorageService.getLinkReceiver(ownerPubky);
  if (!receiver) return;
  try {
    const marker = await PaykitLinkWeb.getReceiverMarker(peerPubky, LINK_RECEIVER_PATH);
    if (!marker) return;
    await PaykitLinkWeb.clearLinkOutbox(
      lookup.handle,
      receiver.receiverAlias,
      peerPubky,
      marker.noisePublicKey,
      coerceReceiverPath(receiver.receiverPath),
      LINK_RECEIVER_PATH,
    );
  } catch {
    // Best-effort.
  }
}

function notifyInboxSynced(ownerPubky: PubkyKey): void {
  for (const listener of inboxSyncListeners) {
    try {
      listener(ownerPubky);
    } catch {
      // Badge refresh must not fail inbox sync.
    }
  }
}

async function syncPeerLocked(peerPubky: PubkyKey): Promise<LinkMessage[]> {
  const ownerPubky = await requireOwner();
  const prior = await StorageService.getLink(ownerPubky, peerPubky);
  const existingRequest = await StorageService.getMessageRequest(ownerPubky, peerPubky);
  if (existingRequest?.status === "declined") {
    await rejectDeclinedInbound(ownerPubky, peerPubky);
    return [];
  }
  try {
    const outcome = await ensureLinkLocked(peerPubky, false, false, "auto");
    const priorRoutedConversationCount = await StorageService.countLinkMessagesForPeer(
      ownerPubky,
      peerPubky,
    );
    const hasPriorRoutedConversation = priorRoutedConversationCount > 0;
    const isNewInbound =
      prior === null &&
      !hasPriorRoutedConversation &&
      (outcome === "ready" || outcome === "handshaking-responder");

    if (isNewInbound && existingRequest?.status !== "accepted") {
      const contact = await StorageService.getContact(peerPubky, ownerPubky);
      const decision = classifyInboundPeer(
        wotInputFromContact(contact, hasPriorRoutedConversation),
      );
      if (decision === "request") {
        await holdAsMessageRequest(ownerPubky, peerPubky);
        if (outcome === "ready") {
          await persistInboundWithoutRouting(ownerPubky, peerPubky);
        }
        return [];
      }
    }

    if (existingRequest?.status === "pending" && !isNewInbound) {
      if (outcome === "ready") {
        await persistInboundWithoutRouting(ownerPubky, peerPubky);
      }
      return [];
    }

    if (outcome !== "ready") return routeUnprocessedStreamItems(ownerPubky, peerPubky);

    const swept = await routeUnprocessedStreamItems(ownerPubky, peerPubky);
    const handle = requireEstablishedHandle(ownerPubky, peerPubky);
    const { messages, snapshot } = await PaykitLinkWeb.receivePrivateMessages(handle);

    if (messages.length === 0) return swept;

    const arrivedAt = Date.now();
    const streamItems = await prepareInboundStreamItems(ownerPubky, peerPubky, messages, arrivedAt);
    if (streamItems.length > 0) {
      await StorageService.saveLinkStreamItems(streamItems);
    }
    const routed = await routeUnprocessedStreamItems(ownerPubky, peerPubky);
    await StorageService.updateLinkSnapshot(ownerPubky, peerPubky, snapshot, "established");
    return [...swept, ...routed];
  } catch (err) {
    if (isLinkNativeError(err) && err.code === "protocol") {
      const stored = await StorageService.getLink(ownerPubky, peerPubky);
      if (stored) await recoverWedgedLink(stored, false, false, "auto", err);
    }
    throw err;
  }
}

async function routeUnprocessedStreamItems(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
): Promise<LinkMessage[]> {
  const items = await StorageService.getUnprocessedLinkStreamItems(ownerPubky, peerPubky);
  const received: LinkMessage[] = [];
  const seenInBatch = new Set<string>();
  for (const item of items) {
    if (shouldDropOversizedKnownInbound(item.rawJson, item.kind)) {
      const peekedOver = peekEnvelopeKind(item.rawJson);
      if (peekedOver !== null && isGroupWireKind(peekedOver)) {
        const groupEnvelope = decodeGroupEnvelope(item.rawJson);
        if (groupEnvelope) {
          await StorageService.markGroupEventSeen(
            ownerPubky,
            groupEnvelope.channel_id,
            peerPubky,
            groupEnvelope.event_id,
            item.receivedAt,
          );
        }
      }
      await StorageService.markLinkStreamItemProcessed(item.id);
      continue;
    }
    const peeked = peekEnvelopeKind(item.rawJson);
    if (peeked === CHAT_ATTACHMENT_KIND) {
      const row = await applyAttachmentInbound({
        ownerPubky,
        senderPubky: peerPubky,
        peerPubky,
        rawJson: item.rawJson,
        receivedAt: item.receivedAt,
      });
      await StorageService.markLinkStreamItemProcessed(item.id);
      if (row) received.push(row);
      continue;
    }
    if (peeked !== null && isPaykitPaymentKind(peeked)) {
      await applyPaymentInbound({
        ownerPubky,
        senderPubky: peerPubky,
        peerPubky,
        rawJson: item.rawJson,
        receivedAt: item.receivedAt,
      });
      await StorageService.markLinkStreamItemProcessed(item.id);
      continue;
    }
    if (peeked !== null && isGroupWireKind(peeked)) {
      const groupEnvelope = decodeGroupEnvelope(item.rawJson);
      if (groupEnvelope) {
        await applyGroupInbound({
          ownerPubky,
          senderPubky: peerPubky,
          envelope: groupEnvelope,
          rawJson: item.rawJson,
          receivedAt: item.receivedAt,
        });
      }
      await StorageService.markLinkStreamItemProcessed(item.id);
      continue;
    }
    const envelope = decodeLinkEnvelope(item.rawJson);
    if (!envelope) continue;
    const dedupKey = `${envelope.kind}:${envelope.event_id}`;
    if (seenInBatch.has(dedupKey)) {
      await StorageService.markLinkStreamItemProcessed(item.id);
      continue;
    }
    seenInBatch.add(dedupKey);
    if (
      await StorageService.hasLinkMessage(ownerPubky, peerPubky, envelope.kind, envelope.event_id)
    ) {
      await StorageService.markLinkStreamItemProcessed(item.id);
      continue;
    }
    const row: LinkMessage = {
      ownerPubky,
      eventId: envelope.event_id,
      conversationId: buildDmConversationId(peerPubky),
      peerPubky,
      senderPubky: peerPubky,
      direction: "received",
      kind: envelope.kind,
      rawJson: item.rawJson,
      body: envelope.body,
      sentAt: envelope.sent_at,
      receivedAt: item.receivedAt,
      deliveryState: "delivered",
    };
    await StorageService.saveLinkMessage(row);
    await StorageService.markLinkStreamItemProcessed(item.id);
    received.push(row);
  }
  return received;
}

/**
 * Per-item wait budget for a drain/recover pass.
 *
 * Does not abort the in-flight send. Aborting would drop the per-peer
 * `withQueue` wait and let a later item for the same peer start while the
 * first PUT is still live — that reorders the outbox and can double-send
 * the same ciphertext. When the budget expires we move on to the next
 * item; the first call keeps the mutex until it settles. Other peers are
 * not blocked. 20s is above the 5s wasm write-body drain bound plus
 * encrypt/PUT slack.
 */
const DRAIN_ITEM_BUDGET_MS = 20_000;

type DrainItemResult = "sent" | "settled" | "deferred" | "failed";

async function withDrainPass<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = drainPassChain;
  drainPassChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function tryClaimDrainItem(id: string, now = Date.now()): boolean {
  const existing = drainItemClaims.get(id);
  if (existing !== undefined && now - existing < DRAIN_CLAIM_TTL_MS) return false;
  drainItemClaims.set(id, now);
  return true;
}

function releaseDrainItem(id: string): void {
  drainItemClaims.delete(id);
}

async function deliverQueuedPayloadWithBudget(
  item: DeliveryQueueItem,
  payload: AnyLinkRetryPayload,
): Promise<void> {
  const work = deliverQueuedPayload(item, payload);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const winner = await Promise.race([
    work.then(() => "done" as const),
    new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), DRAIN_ITEM_BUDGET_MS);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  if (winner === "timeout") {
    console.warn(
      `[LinkService] drain item ${item.id} exceeded ${DRAIN_ITEM_BUDGET_MS}ms; leaving in-flight send running so same-peer queue order is preserved`,
    );
    void work.catch((err) => {
      console.warn(`[LinkService] background drain item ${item.id} failed:`, errorMessage(err));
    });
  }
}

async function deliverQueuedPayload(
  item: DeliveryQueueItem,
  payload: AnyLinkRetryPayload,
): Promise<DrainItemResult> {
  if (!tryClaimDrainItem(item.id)) return "deferred";
  try {
    return await withQueue(payload.peerPubky, () => deliverQueuedPayloadLocked(item, payload));
  } finally {
    releaseDrainItem(item.id);
  }
}

function compareQueueItemAge(a: DeliveryQueueItem, b: DeliveryQueueItem): number {
  const byCreated = a.createdAt - b.createdAt;
  if (byCreated !== 0) return byCreated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function isOlderQueueItem(item: DeliveryQueueItem, than: DeliveryQueueItem): boolean {
  return compareQueueItemAge(item, than) < 0;
}

/**
 * Interval/recover passes must not follow `getDue`/`nextRetryAt` order
 * across a peer: a newer owed item with an earlier due time would encrypt
 * first at an older item's ambiguously-committed nonce. Group by peer, then
 * oldest `createdAt` (then id) so claim-steal redelivery and group fan-out
 * stay on the same sequence.
 */
async function deliverQueueItemsOldestFirst(
  items: DeliveryQueueItem[],
  deliver: (item: DeliveryQueueItem, payload: AnyLinkRetryPayload) => Promise<void>,
): Promise<void> {
  const parsed: { item: DeliveryQueueItem; payload: AnyLinkRetryPayload }[] = [];
  for (const item of items) {
    try {
      const payload = parseRetryPayload(item.payload);
      if (!payload || !(await isCurrentOwner(payload.ownerPubky))) continue;
      parsed.push({ item, payload });
    } catch (err) {
      console.warn(`[LinkService] queue item ${item.id} rejected:`, errorMessage(err));
    }
  }
  parsed.sort((a, b) => {
    const byPeer = a.payload.peerPubky.localeCompare(b.payload.peerPubky);
    if (byPeer !== 0) return byPeer;
    return compareQueueItemAge(a.item, b.item);
  });
  for (const { item, payload } of parsed) {
    try {
      await deliver(item, payload);
    } catch (err) {
      console.warn(`[LinkService] queue item ${item.id} rejected:`, errorMessage(err));
    }
  }
}

/**
 * Retry-first drain of owed same-peer writes. Caller already holds
 * `withQueue(peerPubky)`. Must run before any new plaintext is encrypted
 * for this peer: an ambiguous prior PUT may have committed at nonce N
 * without advancing the client ratchet.
 *
 * `beforeItem` keeps the current row out of the drain (it is not older
 * than itself) and is the replacement for `excludeEventId`. Repeats are
 * safe: newer owed items are not delivered ahead of this row.
 *
 * Any unsuccessful drain (deferred, failed, or another pass holding the
 * item) blocks the new encrypt — never produce a second plaintext at N.
 * Retired items stay parked in the queue so a later send still sees them.
 */
async function drainOwedSamePeerWritesLocked(
  peerPubky: PubkyKey,
  options: { beforeItem: DeliveryQueueItem },
): Promise<"clear" | "blocked"> {
  const items = await StorageService.listDeliveryQueue();
  const owed: { item: DeliveryQueueItem; payload: AnyLinkRetryPayload }[] = [];
  for (const item of items) {
    const payload = parseRetryPayload(item.payload);
    if (!payload || payload.peerPubky !== peerPubky) continue;
    if (!(await isCurrentOwner(payload.ownerPubky))) continue;
    if (!isOlderQueueItem(item, options.beforeItem)) continue;
    owed.push({ item, payload });
  }
  owed.sort((a, b) => compareQueueItemAge(a.item, b.item));
  for (const { item, payload } of owed) {
    if (!tryClaimDrainItem(item.id)) return "blocked";
    try {
      const result = await deliverQueuedPayloadLocked(item, payload);
      if (result !== "sent" && result !== "settled") return "blocked";
    } finally {
      releaseDrainItem(item.id);
    }
  }
  return "clear";
}

async function queueItemStillPresent(id: string): Promise<boolean> {
  const items = await StorageService.listDeliveryQueue();
  return items.some((row) => row.id === id);
}

async function deliverQueuedPayloadLocked(
  item: DeliveryQueueItem,
  payload: AnyLinkRetryPayload,
): Promise<DrainItemResult> {
  const older = await drainOwedSamePeerWritesLocked(payload.peerPubky, { beforeItem: item });
  if (older !== "clear") {
    await RetryQueue.defer(item.id, item.attempts);
    return "deferred";
  }
  if (payload.type === LINK_RETRY_PAYLOAD_TYPE) {
    const row = await StorageService.getLinkMessage(
      payload.ownerPubky,
      payload.senderPubky,
      payload.kind,
      payload.eventId,
    );
    // Sent-state re-check must precede the retire branch: a row that
    // flipped to `sent` under a stale pass must settle, not park+fail.
    if (!row || !isDeliveryOwed(row.deliveryState)) {
      await RetryQueue.recordSuccess(item.id);
      return "settled";
    }
    if (isRetired(item)) {
      await parkRetiredItem(item);
      await markFailed(payload, { excludeItemId: item.id });
      return "failed";
    }
  } else {
    const row = await StorageService.getGroupMessage(
      payload.ownerPubky,
      payload.channelId,
      payload.senderPubky,
      payload.eventId,
    );
    // Sent-state re-check must precede the retire branch (same invariant
    // as the DM arm): a fan-out that already finalized must settle.
    if (!row || row.deliveryState === "sent" || row.deliveryState === "delivered") {
      await RetryQueue.recordSuccess(item.id);
      return "settled";
    }
    if (!(await queueItemStillPresent(item.id))) {
      await RetryQueue.recordSuccess(item.id);
      return "settled";
    }
    if (isRetired(item)) {
      await parkRetiredItem(item);
      await markFailed(payload, { excludeItemId: item.id });
      return "failed";
    }
  }

  let outcome: EnsureOutcome;
  try {
    outcome = await ensureLinkLocked(payload.peerPubky, true, false, "auto");
  } catch (err) {
    if (isTransientLinkError(err)) {
      await RetryQueue.defer(item.id, item.attempts);
      return "deferred";
    }
    const dropped = await RetryQueue.recordFailure(item.id, item.attempts);
    if (dropped) await markFailed(payload, { excludeItemId: item.id });
    return "failed";
  }

  if (outcome !== "ready") {
    await RetryQueue.defer(item.id, item.attempts);
    return "deferred";
  }

  try {
    const handle = requireEstablishedHandle(payload.ownerPubky, payload.peerPubky);
    const wireJson = await wireJsonForNativeSend(
      payload.kind,
      payload.rawJson,
      payload.ownerPubky,
      payload.senderPubky,
      payload.eventId,
      payload.secretFingerprint,
    );
    // R4-F2 / F5 hardening: re-scan immediately before the encrypt, after
    // attachment reconstruction, so this path is scan-adjacent-to-encrypt
    // like attemptPersistedSend / sendPersistedLinkJson / dispatchPreparedDm.
    // Not clear means self-defer — never encrypt ahead of an older owed
    // same-peer write. R6-1: a StorageService/SQLite throw from the scan
    // must defer (attempts unchanged), not fall into this send-failure
    // catch and burn a retry via recordFailure.
    let recheck: "clear" | "blocked";
    try {
      recheck = await drainOwedSamePeerWritesLocked(payload.peerPubky, { beforeItem: item });
    } catch {
      await RetryQueue.defer(item.id, item.attempts);
      return "deferred";
    }
    if (recheck !== "clear") {
      await RetryQueue.defer(item.id, item.attempts);
      return "deferred";
    }
    const { snapshot } = await PaykitLinkWeb.sendPrivateMessageJson(handle, wireJson);
    if (payload.type === LINK_GROUP_FANOUT_PAYLOAD_TYPE) {
      await StorageService.finalizeGroupFanoutSend({
        ownerPubky: payload.ownerPubky,
        peerPubky: payload.peerPubky,
        snapshot,
        queueId: item.id,
      });
      const remaining = await StorageService.countDeliveryQueueForMessage(payload.eventId);
      if (remaining === 0) {
        await StorageService.updateGroupMessageDeliveryState(
          payload.ownerPubky,
          payload.channelId,
          payload.senderPubky,
          payload.eventId,
          "sent",
        );
        if (payload.kind === CHAT_ATTACHMENT_KIND) {
          await StorageService.updateAttachmentDelivery(
            payload.ownerPubky,
            payload.senderPubky,
            payload.eventId,
            "sent",
          );
        }
      }
    } else {
      await StorageService.finalizeLinkSend({
        ownerPubky: payload.ownerPubky,
        peerPubky: payload.peerPubky,
        senderPubky: payload.senderPubky,
        kind: payload.kind,
        eventId: payload.eventId,
        snapshot,
        queueId: item.id,
      });
    }
    await RetryQueue.recordSuccess(item.id);
    return "sent";
  } catch (err) {
    if (isTransientLinkError(err)) {
      await RetryQueue.defer(item.id, item.attempts);
      return "deferred";
    }
    const dropped = await RetryQueue.recordFailure(item.id, item.attempts);
    if (dropped) await markFailed(payload, { excludeItemId: item.id });
    return "failed";
  }
}

async function parkRetiredItem(item: DeliveryQueueItem): Promise<void> {
  await RetryQueue.park(item.id);
}

function isTransientLinkError(err: unknown): boolean {
  return isLinkNativeError(err) && (err.code === "unavailable" || err.code === "network");
}

/**
 * A queued write is still owed while the row has not been confirmed sent.
 *
 * `failed` counts as owed: the row is marked failed so the sender sees the
 * failure and gets a Retry control, but the queue item is what re-attempts the
 * write. Treating `failed` as settled would drop the queue item and leave the
 * message permanently undeliverable.
 */
function isDeliveryOwed(state: LinkDeliveryState): boolean {
  return state === "sending" || state === "failed";
}

async function markFailed(
  payload: AnyLinkRetryPayload,
  options?: { excludeItemId?: string },
): Promise<void> {
  if (payload.type === LINK_GROUP_FANOUT_PAYLOAD_TYPE) {
    const remaining = await StorageService.countDeliveryQueueForMessage(payload.eventId, {
      excludeItemId: options?.excludeItemId,
    });
    if (remaining === 0) {
      await StorageService.updateGroupMessageDeliveryState(
        payload.ownerPubky,
        payload.channelId,
        payload.senderPubky,
        payload.eventId,
        "failed",
      );
      if (payload.kind === CHAT_ATTACHMENT_KIND) {
        await StorageService.updateAttachmentDelivery(
          payload.ownerPubky,
          payload.senderPubky,
          payload.eventId,
          "failed",
        );
      }
    }
    return;
  }
  await StorageService.updateLinkMessageDeliveryState(
    payload.ownerPubky,
    payload.senderPubky,
    payload.kind,
    payload.eventId,
    "failed",
  );
  if (payload.kind === CHAT_ATTACHMENT_KIND) {
    await StorageService.updateAttachmentDelivery(
      payload.ownerPubky,
      payload.senderPubky,
      payload.eventId,
      "failed",
    );
  }
}

/**
 * Snapshot this owner's group fan-out payloads queued for `peerPubky`
 * before their queue rows are deleted. Deleting them without settling
 * would orphan `group_messages` rows in `sending` forever: the lost-item
 * heal covers DM rows only (R4-F4/R4-F5). Filtered by `ownerPubky` so a
 * second owner's stale rows for the same recipient are left alone (F5-4).
 */
async function collectFanoutPayloadsForRecipient(
  peerPubky: PubkyKey,
  ownerPubky: PubkyKey,
): Promise<GroupFanoutRetryPayload[]> {
  const items = await StorageService.listDeliveryQueue();
  const out: GroupFanoutRetryPayload[] = [];
  for (const item of items) {
    if (item.recipientPubky !== peerPubky) continue;
    const payload = parseRetryPayload(item.payload);
    if (payload?.type === LINK_GROUP_FANOUT_PAYLOAD_TYPE && payload.ownerPubky === ownerPubky) {
      out.push(payload);
    }
  }
  return out;
}

/**
 * After this recipient's fan-out queue items are gone, mark each affected
 * group message failed when no other recipient's item remains owed.
 * `markFailed` re-counts the remaining queue rows, so a message still owed
 * to another recipient is left for that recipient's delivery to settle.
 */
async function settleOrphanedFanout(payloads: GroupFanoutRetryPayload[]): Promise<void> {
  for (const payload of payloads) {
    try {
      const row = await StorageService.getGroupMessage(
        payload.ownerPubky,
        payload.channelId,
        payload.senderPubky,
        payload.eventId,
      );
      if (!row || row.deliveryState === "sent" || row.deliveryState === "delivered") continue;
      await markFailed(payload);
    } catch (err) {
      console.warn(
        `[LinkService] Could not settle orphaned fan-out ${payload.eventId}:`,
        errorMessage(err),
      );
    }
  }
}

async function prepareInboundStreamItems(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  messages: readonly { kind: string | null; rawJson: string }[],
  arrivedAt: number,
): Promise<LinkStreamItemInput[]> {
  const out: LinkStreamItemInput[] = [];
  for (const item of messages) {
    if (shouldDropOversizedKnownInbound(item.rawJson, item.kind)) {
      continue;
    }
    const peeked = peekEnvelopeKind(item.rawJson) ?? item.kind;
    if (peeked === CHAT_ATTACHMENT_KIND) {
      const envelope = decodeAttachmentEnvelope(item.rawJson);
      if (!envelope) continue;
      if (!isAttachmentLocationBoundToSender(envelope.location, peerPubky)) {
        if (envelope.channel_id) {
          await StorageService.markGroupEventSeen(
            ownerPubky,
            envelope.channel_id,
            peerPubky,
            envelope.event_id,
            arrivedAt,
          );
        }
        continue;
      }
      await KeyStore.setAttachmentSecret(ownerPubky, peerPubky, envelope.event_id, {
        key: envelope.key,
        nonce: envelope.nonce,
        algorithm: envelope.algorithm,
        ...(envelope.thumbnail
          ? { thumbnail: { key: envelope.thumbnail.key, nonce: envelope.thumbnail.nonce } }
          : {}),
      });
      out.push({
        id: crypto.randomUUID(),
        ownerPubky,
        peerPubky,
        kind: item.kind,
        rawJson: redactAttachmentRawJson(item.rawJson),
        receivedAt: arrivedAt,
      });
      continue;
    }
    out.push({
      id: crypto.randomUUID(),
      ownerPubky,
      peerPubky,
      kind: item.kind,
      rawJson: item.rawJson,
      receivedAt: arrivedAt,
    });
  }
  return out;
}

async function wireJsonForNativeSend(
  kind: string,
  persistedRawJson: string,
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  eventId: string,
  expectedFingerprint?: string,
): Promise<string> {
  if (kind !== CHAT_ATTACHMENT_KIND) return persistedRawJson;
  return reconstructAttachmentWireJson(
    persistedRawJson,
    attachmentKeyRef(ownerPubky, senderPubky, eventId),
    expectedFingerprint,
  );
}

export async function buildPreparedSendIntent(input: {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  kind: string;
  eventId: string;
  rawJson: string;
  body: string;
  sentAt: number;
  queueId: string;
}): Promise<{ message: LinkMessage; queueItem: DeliveryQueueItem }> {
  const persistJson =
    input.kind === CHAT_ATTACHMENT_KIND ? redactAttachmentRawJson(input.rawJson) : input.rawJson;
  const secretFingerprint =
    input.kind === CHAT_ATTACHMENT_KIND
      ? await fingerprintStoredAttachmentSecret(input.ownerPubky, input.ownerPubky, input.eventId)
      : undefined;
  const ts = Date.now();
  return {
    message: {
      ownerPubky: input.ownerPubky,
      eventId: input.eventId,
      conversationId: buildDmConversationId(input.peerPubky),
      peerPubky: input.peerPubky,
      senderPubky: input.ownerPubky,
      direction: "sent",
      kind: input.kind,
      rawJson: persistJson,
      body: input.body,
      sentAt: input.sentAt,
      receivedAt: null,
      deliveryState: "sending",
    },
    queueItem: {
      id: input.queueId,
      messageId: input.eventId,
      recipientPubky: input.peerPubky,
      payload: JSON.stringify(
        retryPayload(
          input.ownerPubky,
          input.peerPubky,
          input.eventId,
          persistJson,
          input.kind,
          secretFingerprint,
        ),
      ),
      attempts: 0,
      nextRetryAt: ts,
      createdAt: ts,
    },
  };
}

async function reconcilePaymentPendingSends(): Promise<void> {
  const ownerPubky = session?.pubky ?? (await KeyStore.getPubky());
  if (!ownerPubky) return;
  const pending = (await StorageService.listPaymentRequestsWithPendingEvent(ownerPubky)) ?? [];
  for (const row of pending) {
    const eventId = row.pendingEventId;
    if (!eventId) continue;
    const message = await StorageService.getLinkMessageByEventId(ownerPubky, ownerPubky, eventId);
    if (!message) continue;
    if (message.deliveryState === "sent") {
      await StorageService.clearPaymentPendingEvent(ownerPubky, eventId);
      continue;
    }
    if (message.deliveryState !== "sending") continue;
    const secretFingerprint = await fingerprintForRetryHeal(ownerPubky, ownerPubky, message.kind, eventId);
    // R4-F2: check + insert under the peer mutex so a heal enqueue is
    // ordered against in-flight deliveries for that peer, never mid-encrypt.
    await withQueue(row.peerPubky, async () => {
      if (await StorageService.hasQueueItemForMessage(eventId)) return;
      const ts = Date.now();
      await StorageService.enqueue({
        id: crypto.randomUUID(),
        messageId: eventId,
        recipientPubky: row.peerPubky,
        payload: JSON.stringify(
          retryPayload(
            ownerPubky,
            row.peerPubky,
            eventId,
            message.rawJson,
            message.kind,
            secretFingerprint,
          ),
        ),
        attempts: 0,
        nextRetryAt: ts,
        createdAt: message.sentAt,
      });
    });
  }
}

async function reconcileLostOwedDeliveries(): Promise<void> {
  const ownerPubky = session?.pubky ?? (await KeyStore.getPubky());
  if (!ownerPubky) return;
  const owed = await StorageService.listOwedOutboundLinkMessages(ownerPubky);
  for (const message of owed) {
    // Defense in depth (R4-F3/F4): `failed` is terminal for heal even if a
    // caller ever widens `listOwedOutboundLinkMessages` again.
    if (message.deliveryState !== "sending") continue;
    const secretFingerprint = await fingerprintForRetryHeal(
      ownerPubky,
      message.senderPubky,
      message.kind,
      message.eventId,
    );
    // R4-F2: check + insert under the peer mutex so a heal enqueue is
    // ordered against in-flight deliveries for that peer, never mid-encrypt.
    await withQueue(message.peerPubky, async () => {
      if (await StorageService.hasQueueItemForMessage(message.eventId)) return;
      const ts = Date.now();
      await StorageService.enqueue({
        id: crypto.randomUUID(),
        messageId: message.eventId,
        recipientPubky: message.peerPubky,
        payload: JSON.stringify(
          retryPayload(
            ownerPubky,
            message.peerPubky,
            message.eventId,
            message.rawJson,
            message.kind,
            secretFingerprint,
          ),
        ),
        attempts: 0,
        nextRetryAt: ts,
        createdAt: message.sentAt,
      });
    });
  }
}

async function fingerprintForRetryHeal(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  kind: string,
  eventId: string,
): Promise<string | undefined> {
  if (kind !== CHAT_ATTACHMENT_KIND) return undefined;
  try {
    return await fingerprintStoredAttachmentSecret(ownerPubky, senderPubky, eventId);
  } catch {
    return undefined;
  }
}

function secretFingerprintFromQueuedPayload(payloadJson: string, kind: string): string | undefined {
  if (kind !== CHAT_ATTACHMENT_KIND) return undefined;
  const payload = parseRetryPayload(payloadJson);
  return payload?.secretFingerprint;
}

function requireQueuedAttachmentFingerprint(payloadJson: string, kind: string): string | undefined {
  if (kind !== CHAT_ATTACHMENT_KIND) return undefined;
  const stored = secretFingerprintFromQueuedPayload(payloadJson, kind);
  if (!stored) {
    throw createLinkNativeError(
      "validation",
      "Queued attachment payload has no secretFingerprint",
    );
  }
  return stored;
}

function retryPayload(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  eventId: string,
  rawJson: string,
  kind: string = CHAT_MESSAGE_KIND,
  secretFingerprint?: string,
): LinkRetryPayload {
  return {
    type: LINK_RETRY_PAYLOAD_TYPE,
    ownerPubky,
    peerPubky,
    senderPubky: ownerPubky,
    kind,
    eventId,
    rawJson,
    ...(secretFingerprint ? { secretFingerprint } : {}),
  };
}

async function dispatchPreparedDm(input: {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  outcome: EnsureOutcome;
  kind: string;
  eventId: string;
  rawJson: string;
  body: string;
  sentAt: number;
}): Promise<LinkMessage> {
  const queueId = crypto.randomUUID();
  const persistJson =
    input.kind === CHAT_ATTACHMENT_KIND ? redactAttachmentRawJson(input.rawJson) : input.rawJson;
  const secretFingerprint =
    input.kind === CHAT_ATTACHMENT_KIND
      ? await fingerprintStoredAttachmentSecret(input.ownerPubky, input.ownerPubky, input.eventId)
      : undefined;
  const message: LinkMessage = {
    ownerPubky: input.ownerPubky,
    eventId: input.eventId,
    conversationId: buildDmConversationId(input.peerPubky),
    peerPubky: input.peerPubky,
    senderPubky: input.ownerPubky,
    direction: "sent",
    kind: input.kind,
    rawJson: persistJson,
    body: input.body,
    sentAt: input.sentAt,
    receivedAt: null,
    deliveryState: "sending",
  };
  const ts = Date.now();
  await StorageService.persistLinkSendIntent({
    message,
    queueItem: {
      id: queueId,
      messageId: input.eventId,
      recipientPubky: input.peerPubky,
      payload: JSON.stringify(
        retryPayload(
          input.ownerPubky,
          input.peerPubky,
          input.eventId,
          persistJson,
          input.kind,
          secretFingerprint,
        ),
      ),
      attempts: 0,
      nextRetryAt: ts,
      createdAt: ts,
    },
  });

  if (input.outcome !== "ready") return message;

  const beforeItem: DeliveryQueueItem = {
    id: queueId,
    messageId: input.eventId,
    recipientPubky: input.peerPubky,
    payload: "",
    attempts: 0,
    nextRetryAt: ts,
    createdAt: ts,
  };
  const markBlocked = async (): Promise<LinkMessage> => {
    const blocked = retryPayload(
      input.ownerPubky,
      input.peerPubky,
      input.eventId,
      persistJson,
      input.kind,
      secretFingerprint,
    );
    try {
      await markFailed(blocked);
    } catch (markErr) {
      console.warn(
        `[LinkService] Could not mark blocked send failed for ${input.peerPubky}:`,
        errorMessage(markErr),
      );
      return message;
    }
    return { ...message, deliveryState: "failed" };
  };

  const prior = await drainOwedSamePeerWritesLocked(input.peerPubky, { beforeItem });
  if (prior !== "clear") return markBlocked();

  try {
    const handle = requireEstablishedHandle(input.ownerPubky, input.peerPubky);
    const wireJson = await wireJsonForNativeSend(
      input.kind,
      persistJson,
      input.ownerPubky,
      input.ownerPubky,
      input.eventId,
      secretFingerprint,
    );
    // R4-F2: re-scan just before the encrypt. The window since the entry
    // scan is only attachment reconstruction, but the re-scan is one SELECT
    // and does not re-acquire withQueue, so take it.
    const recheck = await drainOwedSamePeerWritesLocked(input.peerPubky, { beforeItem });
    if (recheck !== "clear") return markBlocked();
    const { snapshot } = await PaykitLinkWeb.sendPrivateMessageJson(handle, wireJson);
    await StorageService.finalizeLinkSend({
      ownerPubky: input.ownerPubky,
      peerPubky: input.peerPubky,
      senderPubky: input.ownerPubky,
      kind: input.kind,
      eventId: input.eventId,
      snapshot,
      queueId,
    });
    return { ...message, deliveryState: "sent" };
  } catch (err) {
    console.warn(`[LinkService] Send failed for ${input.peerPubky}:`, errorMessage(err));
    // A transient failure is worth waiting on: the queue item is already due and
    // the sender sees the message as still on its way. Anything else has to
    // surface, or the message sits at "sending" with no failure and no retry
    // control for as long as the conversation is open.
    if (isTransientLinkError(err)) return message;
    const failedPayload = retryPayload(
      input.ownerPubky,
      input.peerPubky,
      input.eventId,
      persistJson,
      input.kind,
      secretFingerprint,
    );
    try {
      await markFailed(failedPayload);
    } catch (markErr) {
      console.warn(
        `[LinkService] Could not mark send failed for ${input.peerPubky}:`,
        errorMessage(markErr),
      );
      return message;
    }
    return { ...message, deliveryState: "failed" };
  }
}

function parseRetryPayload(payload: string): AnyLinkRetryPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.ownerPubky !== "string") return null;
  if (typeof candidate.peerPubky !== "string") return null;
  if (typeof candidate.senderPubky !== "string") return null;
  if (typeof candidate.kind !== "string") return null;
  if (typeof candidate.eventId !== "string") return null;
  if (typeof candidate.rawJson !== "string") return null;
  const secretFingerprint =
    typeof candidate.secretFingerprint === "string" ? candidate.secretFingerprint : undefined;
  if (candidate.type === LINK_GROUP_FANOUT_PAYLOAD_TYPE) {
    if (typeof candidate.channelId !== "string") return null;
    return {
      type: LINK_GROUP_FANOUT_PAYLOAD_TYPE,
      ownerPubky: candidate.ownerPubky,
      peerPubky: candidate.peerPubky,
      senderPubky: candidate.senderPubky,
      kind: candidate.kind,
      eventId: candidate.eventId,
      channelId: candidate.channelId,
      rawJson: candidate.rawJson,
      ...(secretFingerprint ? { secretFingerprint } : {}),
    };
  }
  if (candidate.type !== LINK_RETRY_PAYLOAD_TYPE) return null;
  return {
    type: LINK_RETRY_PAYLOAD_TYPE,
    ownerPubky: candidate.ownerPubky,
    peerPubky: candidate.peerPubky,
    senderPubky: candidate.senderPubky,
    kind: candidate.kind,
    eventId: candidate.eventId,
    rawJson: candidate.rawJson,
    ...(secretFingerprint ? { secretFingerprint } : {}),
  };
}

function roleStatus(role: LinkRole): LinkStatus {
  return role === "initiator" ? "handshaking-initiator" : "handshaking-responder";
}

async function requireOwner(): Promise<PubkyKey> {
  const owner = session?.pubky ?? (await KeyStore.getPubky());
  if (!owner) throw new Error("LinkService: no local pubky");
  return owner;
}

function requireSessionHandle(): SessionHandle {
  const active = currentSession();
  if (active) return active.handle;
  throw createLinkNativeError(
    "auth",
    "Enable encrypted messaging to write to your homeserver.",
  );
}

function requireEstablishedHandle(ownerPubky: PubkyKey, peerPubky: PubkyKey): string {
  const live = liveHandles.get(linkKey(ownerPubky, peerPubky));
  if (!live || live.status !== "established") {
    throw createLinkNativeError(
      "network",
      `LinkService: missing established link handle for ${peerPubky}`,
    );
  }
  return live.linkId;
}

async function isCurrentOwner(ownerPubky: PubkyKey): Promise<boolean> {
  const current = session?.pubky ?? (await KeyStore.getPubky());
  return current !== null && current === ownerPubky;
}

async function clearPeerOutboxBestEffort(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  peerPubky: PubkyKey,
  remoteNoisePublicKey: string,
  localPath: string,
  remotePath: string,
): Promise<void> {
  try {
    await PaykitLinkWeb.clearLinkOutbox(
      activeSession.handle,
      receiver.receiverAlias,
      peerPubky,
      remoteNoisePublicKey,
      coerceReceiverPath(localPath),
      coerceReceiverPath(remotePath),
    );
  } catch {
    // Best-effort.
  }
}

function linkKey(ownerPubky: PubkyKey, peerPubky: PubkyKey): string {
  return `${ownerPubky}:${peerPubky}`;
}

function errorMessage(err: unknown): string {
  if (isLinkNativeError(err)) return `[${err.code}] ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

async function closeQuietly(linkId: string): Promise<void> {
  try {
    await PaykitLinkWeb.closeLink(linkId);
  } catch (err) {
    if (isLinkNativeError(err) && err.code === "unavailable") throw err;
  }
}

export function ownerDocumentPath(url: string): string {
  const match = /^pubky:\/\/[^/]+(\/.*)$/.exec(url);
  if (match?.[1]) return match[1];
  if (url.startsWith("/")) return url;
  throw new Error(`LinkService: invalid owner document url`);
}

async function withQueue<T>(peerPubky: PubkyKey, operation: () => Promise<T>): Promise<T> {
  const owner = session?.pubky ?? (await KeyStore.getPubky()) ?? "";
  const key = `${owner}:${peerPubky}`;
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  const tracked = next.catch(() => undefined);
  queues.set(key, tracked);
  try {
    return await next;
  } finally {
    if (queues.get(key) === tracked) {
      queues.delete(key);
    }
  }
}

export type { LinkNativeError };
