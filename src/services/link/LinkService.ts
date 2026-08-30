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
import { RetryQueue } from "../RetryQueue";
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
import { reconstructAttachmentWireJson } from "../attachments/redaction";
import { applyPaymentInbound } from "../payments/applyPaymentInbound";
import { isPaykitPaymentKind } from "../../types/payment";
import { shouldDropOversizedKnownInbound } from "./inboundEnvelope";
import { provisionReceiver } from "./provisionReceiver";
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

export const LINK_RETRY_DRAIN_INTERVAL_MS = 30_000;

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
}

type AnyLinkRetryPayload = LinkRetryPayload | GroupFanoutRetryPayload;

type ActiveSession = { handle: SessionHandle; pubky: string };
type LiveHandle =
  | { status: "established"; linkId: string }
  | { status: "handshaking"; linkId: string; role: LinkRole };
type SessionLookup = ActiveSession | { status: "offline" } | null;
type EnsureOutcome = LinkStatus | "idle";

let session: ActiveSession | null = null;
let restoreInFlight: Promise<SessionLookup> | null = null;
const liveHandles = new Map<string, LiveHandle>();
const queues = new Map<string, Promise<unknown>>();
let drainTimer: ReturnType<typeof setInterval> | null = null;
const inboxSyncListeners = new Set<(ownerPubky: PubkyKey) => void>();

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

  async provisionHarnessReceiver(): Promise<{
    pubky: string;
    receiverPath: string;
    noisePublicKey: string;
  }> {
    const active = requireActiveSession();
    return provisionReceiver(active.handle, active.pubky);
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

  async ensureLinkWith(peerPubky: PubkyKey): Promise<LinkStatus> {
    return withQueue(peerPubky, async () => {
      try {
        const outcome = await ensureLinkLocked(peerPubky, true, false);
        return outcome === "idle" ? "error" : outcome;
      } catch (err) {
        if (isLinkNativeError(err) && err.code === "unavailable") return "native-missing";
        console.warn(`[LinkService] ensureLinkWith failed for ${peerPubky}:`, errorMessage(err));
        return "error";
      }
    });
  },

  async sendDm(peerPubky: PubkyKey, body: string): Promise<LinkMessage> {
    return withQueue(peerPubky, async () => {
      const outcome = await ensureLinkLocked(peerPubky, true, false);
      if (
        outcome !== "ready" &&
        outcome !== "handshaking-initiator" &&
        outcome !== "handshaking-responder"
      ) {
        throw new Error(
          `LinkService.sendDm: cannot send to ${peerPubky} — link status is '${outcome}'`,
        );
      }
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
      const outcome = await ensureLinkLocked(input.peerPubky, true, false);
      if (
        outcome !== "ready" &&
        outcome !== "handshaking-initiator" &&
        outcome !== "handshaking-responder"
      ) {
        throw new Error(
          `LinkService.sendPreparedMessage: cannot send to ${input.peerPubky} — link status is '${outcome}'`,
        );
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
    let outcome: EnsureOutcome;
    try {
      outcome = await ensureLinkLocked(input.peerPubky, true, false);
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
    try {
      const ownerPubky = await requireOwner();
      const handle = requireEstablishedHandle(ownerPubky, input.peerPubky);
      const wireJson = await wireJsonForNativeSend(
        input.kind,
        input.rawJson,
        ownerPubky,
        ownerPubky,
        input.eventId,
      );
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
        outcome = await ensureLinkLocked(input.peerPubky, true, false);
      } catch {
        return "queued";
      }
      if (outcome !== "ready") return "queued";
      try {
        const ownerPubky = await requireOwner();
        const handle = requireEstablishedHandle(ownerPubky, input.peerPubky);
        const wireJson = await wireJsonForNativeSend(
          input.kind,
          input.rawJson,
          ownerPubky,
          ownerPubky,
          input.eventId,
        );
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
    await reconcilePaymentPendingSends();
    const items = await StorageService.listDeliveryQueue();
    for (const item of items) {
      const payload = parseRetryPayload(item.payload);
      if (!payload || !(await isCurrentOwner(payload.ownerPubky))) continue;
      if (payload.type === LINK_RETRY_PAYLOAD_TYPE) {
        const row = await StorageService.getLinkMessage(
          payload.ownerPubky,
          payload.senderPubky,
          payload.kind,
          payload.eventId,
        );
        if (!row || row.deliveryState !== "sending") continue;
      }
      await deliverQueuedPayload(item, payload);
    }
  },

  async drainRetries(): Promise<void> {
    const due = await RetryQueue.getDue();
    for (const item of due) {
      const payload = parseRetryPayload(item.payload);
      if (!payload || !(await isCurrentOwner(payload.ownerPubky))) continue;
      await deliverQueuedPayload(item, payload);
    }
  },

  async retryPendingSends(): Promise<void> {
    await LinkService.drainRetries();
  },

  async syncInbox(peers?: PubkyKey[]): Promise<LinkMessage[]> {
    const ownerPubky = await requireOwner();
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
};

export function startLinkRetryDrain(intervalMs = LINK_RETRY_DRAIN_INTERVAL_MS): () => void {
  stopLinkRetryDrain();
  drainTimer = setInterval(() => {
    void LinkService.drainRetries();
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
      void LinkService.recoverPendingSends();
      void LinkService.drainRetries();
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
): Promise<EnsureOutcome> {
  const lookup = await sessionOrRestore();
  if (lookup && "status" in lookup && lookup.status === "offline") return "session-offline";
  if (!isActiveSession(lookup)) return "needs-enable";
  const activeSession = lookup;
  const ownerPubky = activeSession.pubky;
  const receiver = await StorageService.getLinkReceiver(ownerPubky);
  if (!receiver?.markerPublished) return "needs-enable";
  const localPath = assertValidReceiverPath(coerceReceiverPath(receiver.receiverPath));

  const key = linkKey(ownerPubky, peerPubky);
  const live = liveHandles.get(key);
  if (live?.status === "established") return "ready";
  if (live?.status === "handshaking") {
    return advanceLiveHandshake(
      activeSession,
      receiver,
      ownerPubky,
      peerPubky,
      live,
      alreadyRecovered,
    );
  }

  const stored = await StorageService.getLink(ownerPubky, peerPubky);
  if (stored?.status === "established") {
    return restoreEstablished(activeSession, receiver, stored, alreadyRecovered);
  }
  if (stored?.status === "handshaking") {
    return restoreAndAdvanceHandshake(activeSession, receiver, stored, alreadyRecovered);
  }

  const marker = await PaykitLinkWeb.getReceiverMarker(peerPubky, localPath);
  if (marker === null) return allowInitiate ? "not-enrolled" : "idle";

  let inbound: Extract<LinkProbeResult, { result: "pending" | "established" }> | null;
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
      if (!allowInitiate) return "idle";
      return initiateHandshake(
        activeSession,
        receiver,
        ownerPubky,
        peerPubky,
        marker,
        localPath,
        alreadyRecovered,
      );
    }
    throw err;
  }
  if (inbound !== null) {
    return adoptInboundHandshake(ownerPubky, peerPubky, marker, localPath, inbound);
  }

  if (!allowInitiate) return "idle";

  return initiateHandshake(
    activeSession,
    receiver,
    ownerPubky,
    peerPubky,
    marker,
    localPath,
    alreadyRecovered,
  );
}

async function restoreEstablished(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  stored: LinkRecord,
  alreadyRecovered: boolean,
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
    return handleLinkFailure(err, stored, alreadyRecovered, true);
  }
}

async function restoreAndAdvanceHandshake(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  stored: LinkRecord,
  alreadyRecovered: boolean,
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
    );
  } catch (err) {
    return handleLinkFailure(err, stored, alreadyRecovered, true);
  }
}

async function advanceLiveHandshake(
  activeSession: ActiveSession,
  receiver: LinkReceiver,
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  live: Extract<LiveHandle, { status: "handshaking" }>,
  alreadyRecovered: boolean,
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
      updatedAt: Date.now(),
    };
    return handleLinkFailure(err, fallback, alreadyRecovered, true);
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
): Promise<EnsureOutcome> {
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
  });
  liveHandles.set(key, { status: "handshaking", linkId: inbound.linkId, role: "responder" });
  return "handshaking-responder";
}

async function handleLinkFailure(
  err: unknown,
  stored: LinkRecord,
  alreadyRecovered: boolean,
  allowInitiate: boolean,
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
      return recoverWedgedLink(stored, alreadyRecovered, allowInitiate, err);
    }
    return roleStatus(stored.role);
  }
  if (isLinkNativeError(err) && err.code === "protocol") {
    return recoverWedgedLink(stored, alreadyRecovered, allowInitiate, err);
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
    return recoverWedgedLink(stored, alreadyRecovered, allowInitiate, err);
  }
  console.warn(`[LinkService] Handshake step failed for ${stored.peerPubky}:`, errorMessage(err));
  return roleStatus(stored.role);
}

async function recoverWedgedLink(
  stored: LinkRecord,
  alreadyRecovered: boolean,
  allowInitiate: boolean,
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

  await wipeLinkState(stored);

  if (alreadyRecovered) return "error";
  return ensureLinkLocked(stored.peerPubky, allowInitiate, true);
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
    const outcome = await ensureLinkLocked(peerPubky, false, false);
    const priorMessageCount = await StorageService.countLinkMessagesForPeer(ownerPubky, peerPubky);
    const hasEstablishedConversation = priorMessageCount > 0;
    const isNewInbound =
      prior === null &&
      !hasEstablishedConversation &&
      (outcome === "ready" || outcome === "handshaking-responder");

    if (isNewInbound && existingRequest?.status !== "accepted") {
      const contact = await StorageService.getContact(peerPubky, ownerPubky);
      const decision = classifyInboundPeer(
        wotInputFromContact(contact, hasEstablishedConversation),
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
      if (stored) await recoverWedgedLink(stored, false, false, err);
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

async function deliverQueuedPayload(
  item: DeliveryQueueItem,
  payload: AnyLinkRetryPayload,
): Promise<void> {
  await withQueue(payload.peerPubky, async () => {
    if (payload.type === LINK_RETRY_PAYLOAD_TYPE) {
      const row = await StorageService.getLinkMessage(
        payload.ownerPubky,
        payload.senderPubky,
        payload.kind,
        payload.eventId,
      );
      if (!row || row.deliveryState !== "sending") {
        await RetryQueue.recordSuccess(item.id);
        return;
      }
    } else {
      const exists = await StorageService.hasGroupMessage(
        payload.ownerPubky,
        payload.channelId,
        payload.senderPubky,
        payload.eventId,
      );
      if (!exists) {
        await RetryQueue.recordSuccess(item.id);
        return;
      }
    }

    let outcome: EnsureOutcome;
    try {
      outcome = await ensureLinkLocked(payload.peerPubky, true, false);
    } catch (err) {
      if (isTransientLinkError(err)) {
        await RetryQueue.defer(item.id, item.attempts);
        return;
      }
      const dropped = await RetryQueue.recordFailure(item.id, item.attempts);
      if (dropped) await markFailed(payload);
      return;
    }

    if (outcome !== "ready") {
      await RetryQueue.defer(item.id, item.attempts);
      return;
    }

    try {
      const handle = requireEstablishedHandle(payload.ownerPubky, payload.peerPubky);
      const wireJson = await wireJsonForNativeSend(
        payload.kind,
        payload.rawJson,
        payload.ownerPubky,
        payload.senderPubky,
        payload.eventId,
      );
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
    } catch (err) {
      if (isTransientLinkError(err)) {
        await RetryQueue.defer(item.id, item.attempts);
        return;
      }
      const dropped = await RetryQueue.recordFailure(item.id, item.attempts);
      if (dropped) await markFailed(payload);
    }
  });
}

function isTransientLinkError(err: unknown): boolean {
  return isLinkNativeError(err) && (err.code === "unavailable" || err.code === "network");
}

async function markFailed(payload: AnyLinkRetryPayload): Promise<void> {
  if (payload.type === LINK_GROUP_FANOUT_PAYLOAD_TYPE) {
    const remaining = await StorageService.countDeliveryQueueForMessage(payload.eventId);
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
): Promise<string> {
  if (kind !== CHAT_ATTACHMENT_KIND) return persistedRawJson;
  return reconstructAttachmentWireJson(
    persistedRawJson,
    attachmentKeyRef(ownerPubky, senderPubky, eventId),
  );
}

export function buildPreparedSendIntent(input: {
  ownerPubky: PubkyKey;
  peerPubky: PubkyKey;
  kind: string;
  eventId: string;
  rawJson: string;
  body: string;
  sentAt: number;
  queueId: string;
}): { message: LinkMessage; queueItem: DeliveryQueueItem } {
  const persistJson =
    input.kind === CHAT_ATTACHMENT_KIND ? redactAttachmentRawJson(input.rawJson) : input.rawJson;
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
        retryPayload(input.ownerPubky, input.peerPubky, input.eventId, persistJson, input.kind),
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
    if (await StorageService.hasQueueItemForMessage(eventId)) continue;
    const ts = Date.now();
    await StorageService.enqueue({
      id: crypto.randomUUID(),
      messageId: eventId,
      recipientPubky: row.peerPubky,
      payload: JSON.stringify(
        retryPayload(ownerPubky, row.peerPubky, eventId, message.rawJson, message.kind),
      ),
      attempts: 0,
      nextRetryAt: ts,
      createdAt: ts,
    });
  }
}

function retryPayload(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  eventId: string,
  rawJson: string,
  kind: string = CHAT_MESSAGE_KIND,
): LinkRetryPayload {
  return {
    type: LINK_RETRY_PAYLOAD_TYPE,
    ownerPubky,
    peerPubky,
    senderPubky: ownerPubky,
    kind,
    eventId,
    rawJson,
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
        retryPayload(input.ownerPubky, input.peerPubky, input.eventId, persistJson, input.kind),
      ),
      attempts: 0,
      nextRetryAt: ts,
      createdAt: ts,
    },
  });

  if (input.outcome !== "ready") return message;

  try {
    const handle = requireEstablishedHandle(input.ownerPubky, input.peerPubky);
    const wireJson = await wireJsonForNativeSend(
      input.kind,
      persistJson,
      input.ownerPubky,
      input.ownerPubky,
      input.eventId,
    );
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
    return message;
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
