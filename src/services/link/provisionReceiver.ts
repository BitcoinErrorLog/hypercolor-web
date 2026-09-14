import { zeroizeBytes } from "@/lib/hex";
import { KeyStore } from "@/services/KeyStore";
import { StorageService } from "@/services/StorageService";
import {
  LINK_RECEIVER_PATH,
  assertValidReceiverPath,
  coerceReceiverPath,
  type ReceiverRole,
} from "@/types/link";
import type { PubkyKey } from "@/types";
import { PaykitLinkWeb, type SessionHandle } from "./PaykitLinkWeb";
import { ensureChatKindsVReceiverJson } from "./chatKindsAdvertisement";
import { getLiveSession, persistReceiverPath } from "./session";
import { setReceiverRoleState } from "./receiverRoleStore";
import { MAX_ATTEMPTS, nextAttemptAt } from "../RetryQueue";

export const RECEIVER_NOISE_ALIAS = LINK_RECEIVER_PATH;
export const RECEIVER_MARKER_PUBLISH_BUDGET_MS = 15_000;

export const STANDBY_BANNER_TITLE = "Another device is receiving new messages";
export const STANDBY_BANNER_BODY =
  "This identity is signed in somewhere else, and that device is the one that can accept new chats. Conversations already on this device still work. Take over if you want new message requests and new handshakes to land here instead.";
export const STANDBY_PRIMARY = "Receive on this device";
export const STANDBY_SECONDARY = "Keep using this device for existing chats";
export const TAKEOVER_TOAST =
  "This device now receives new messages. Other signed-in devices will stop accepting new chats until they take over.";

export const REENABLE_BANNER_TITLE = "This device stopped receiving new chats";
export const REENABLE_BANNER_BODY =
  "The published receiver marker is gone. Conversations already on this device still work. Re-enable receiving if you want new message requests and new handshakes to land here.";
export const REENABLE_PRIMARY = "Re-enable receiving";
export const REENABLE_SECONDARY = "Not now";

async function withBudget<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            Object.assign(new Error(`${label} timed out after ${ms}ms`), {
              name: "SessionResumeTimeout",
            }),
          );
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type ProvisionedReceiver = {
  pubky: string;
  receiverPath: string;
  noisePublicKey: string;
  receiverRole: ReceiverRole;
};

async function mintReceiver(
  ownerPubky: PubkyKey,
  receiverPath: string,
): Promise<{ noisePublicKey: string }> {
  const already = await KeyStore.getReceiverNoiseSecret(RECEIVER_NOISE_ALIAS);
  if (already) {
    zeroizeBytes(already);
    throw new Error("mintReceiver: receiver secret already exists");
  }
  const secret = await PaykitLinkWeb.generateNoiseSecretKey();
  try {
    await KeyStore.setReceiverNoiseSecret(RECEIVER_NOISE_ALIAS, secret);
    const noisePublicKey = await PaykitLinkWeb.noisePublicKeyFromSecret(secret);
    await StorageService.upsertLinkReceiver({
      ownerPubky,
      receiverAlias: RECEIVER_NOISE_ALIAS,
      receiverPath,
      markerPublished: false,
      receiverRole: "active",
      lastSeenOwnMarkerPk: null,
    });
    return { noisePublicKey };
  } finally {
    zeroizeBytes(secret);
  }
}

async function publicKeyFromStoredSecret(alias: string): Promise<string | null> {
  const secret = await KeyStore.getReceiverNoiseSecret(alias);
  if (!secret) return null;
  try {
    return await PaykitLinkWeb.noisePublicKeyFromSecret(secret);
  } finally {
    zeroizeBytes(secret);
  }
}

async function persistReceiverRow(
  pubky: PubkyKey,
  receiverPath: string,
  markerPublished: boolean,
  receiverRole: ReceiverRole,
  lastSeenOwnMarkerPk: string | null,
): Promise<void> {
  await StorageService.upsertLinkReceiver({
    ownerPubky: pubky,
    receiverAlias: RECEIVER_NOISE_ALIAS,
    receiverPath,
    markerPublished,
    receiverRole,
    lastSeenOwnMarkerPk,
  });
  setReceiverRoleState(receiverRole, null);
}

async function retainPublishUnknown(
  ownerPubky: PubkyKey,
  noisePublicKey: string,
  attempts: number,
): Promise<void> {
  await StorageService.upsertLinkReceiverRetry({
    ownerPubky,
    sessionAlias: RECEIVER_NOISE_ALIAS,
    noisePublicKey,
    nextRetryAt: nextAttemptAt(attempts),
    attempts: attempts + 1,
  });
}

async function existingRetryAttempts(ownerPubky: PubkyKey): Promise<number> {
  return (await StorageService.getLinkReceiverRetry(ownerPubky))?.attempts ?? 0;
}

async function publishOwnMarker(
  session: SessionHandle,
  receiverPath: string,
  noisePublicKey: string,
): Promise<void> {
  await withBudget(
    PaykitLinkWeb.publishReceiverMarker(
      session,
      receiverPath,
      noisePublicKey,
      true,
      false,
      false,
      false,
    ),
    RECEIVER_MARKER_PUBLISH_BUDGET_MS,
    "publish receiver marker",
  );
}

/**
 * GET-first publish. Fetch failure is not absence: never PUT on GET error.
 */
export async function inspectOwnPublishedMarker(
  ownerPubky: PubkyKey,
  receiverPath: string,
): Promise<{ kind: "absent" } | { kind: "present"; noisePublicKey: string }> {
  const marker = await PaykitLinkWeb.getReceiverMarker(ownerPubky, receiverPath);
  if (marker === null || typeof marker.noisePublicKey !== "string" || marker.noisePublicKey === "") {
    return { kind: "absent" };
  }
  return { kind: "present", noisePublicKey: marker.noisePublicKey };
}

export async function provisionReceiver(
  session: SessionHandle,
  pubky: PubkyKey,
): Promise<ProvisionedReceiver> {
  if (session.pubky() !== pubky) {
    throw new Error("provisionReceiver: session owner mismatch");
  }
  const receiverPath = assertValidReceiverPath(LINK_RECEIVER_PATH);
  await KeyStore.setPubky(pubky);
  const existing = await StorageService.getLinkReceiver(pubky);
  let noisePublicKey: string;
  if (existing) {
    const reused = await publicKeyFromStoredSecret(existing.receiverAlias);
    if (reused) {
      noisePublicKey = reused;
    } else {
      await StorageService.deleteLinkReceiver(pubky);
      ({ noisePublicKey } = await mintReceiver(pubky, receiverPath));
    }
  } else {
    const reused = await publicKeyFromStoredSecret(RECEIVER_NOISE_ALIAS);
    if (reused) {
      noisePublicKey = reused;
    } else {
      ({ noisePublicKey } = await mintReceiver(pubky, receiverPath));
    }
  }

  let published: Awaited<ReturnType<typeof inspectOwnPublishedMarker>>;
  try {
    published = await inspectOwnPublishedMarker(pubky, receiverPath);
  } catch (error) {
    await persistReceiverRow(pubky, receiverPath, false, "active", null);
    await retainPublishUnknown(pubky, noisePublicKey, await existingRetryAttempts(pubky));
    throw error;
  }

  if (published.kind === "present" && published.noisePublicKey !== noisePublicKey) {
    await persistReceiverRow(pubky, receiverPath, false, "standby", published.noisePublicKey);
    setReceiverRoleState("standby", null);
    return { pubky, receiverPath, noisePublicKey, receiverRole: "standby" };
  }

  if (published.kind === "present" && published.noisePublicKey === noisePublicKey) {
    try {
      await ensureChatKindsVReceiverJson(session, pubky, receiverPath, noisePublicKey);
    } catch (error) {
      await retainPublishUnknown(pubky, noisePublicKey, await existingRetryAttempts(pubky));
      throw error;
    }
    await StorageService.deleteLinkReceiverRetry(pubky);
    await persistReceiverRow(pubky, receiverPath, true, "active", published.noisePublicKey);
    await persistReceiverPath(pubky, receiverPath);
    return { pubky, receiverPath, noisePublicKey, receiverRole: "active" };
  }

  try {
    await publishOwnMarker(session, receiverPath, noisePublicKey);
  } catch (error) {
    await persistReceiverRow(pubky, receiverPath, false, "active", null);
    await retainPublishUnknown(pubky, noisePublicKey, await existingRetryAttempts(pubky));
    throw error;
  }
  const reconciled = await inspectOwnPublishedMarker(pubky, receiverPath);
  if (reconciled.kind !== "present" || reconciled.noisePublicKey !== noisePublicKey) {
    await persistReceiverRow(pubky, receiverPath, false, "active", reconciled.kind === "present" ? reconciled.noisePublicKey : null);
    await retainPublishUnknown(pubky, noisePublicKey, await existingRetryAttempts(pubky));
    throw new Error("receiver marker publish was not confirmed");
  }
  try {
    await ensureChatKindsVReceiverJson(session, pubky, receiverPath, noisePublicKey);
  } catch (error) {
    await persistReceiverRow(pubky, receiverPath, true, "active", noisePublicKey);
    await retainPublishUnknown(pubky, noisePublicKey, await existingRetryAttempts(pubky));
    throw error;
  }
  await StorageService.deleteLinkReceiverRetry(pubky);
  await persistReceiverRow(pubky, receiverPath, true, "active", noisePublicKey);
  await persistReceiverPath(pubky, receiverPath);
  return { pubky, receiverPath, noisePublicKey, receiverRole: "active" };
}

const healReceiverInFlight = new Map<string, Promise<boolean>>();

/**
 * KeyStore has the receiver secret but sqlite `link_receivers` is missing
 * (unsigned persist / namespace miss). Reuses the existing secret: GET-first,
 * persist the row, PUT only when the marker is confirmed absent. Never mints.
 */
export async function healMissingReceiverRow(
  session: SessionHandle,
  pubky: PubkyKey,
): Promise<boolean> {
  const inflight = healReceiverInFlight.get(pubky);
  if (inflight) return inflight;
  const run = (async () => {
    try {
      const { ensureWriter } = await import("@/services/tabLock");
      const { waitForOwnerScopedSqlite } = await import("@/db");
      await ensureWriter();
      await waitForOwnerScopedSqlite();
      if (await StorageService.getLinkReceiver(pubky)) return true;
      let secret: Uint8Array | null = null;
      try {
        secret = await KeyStore.getReceiverNoiseSecret(RECEIVER_NOISE_ALIAS);
      } catch {
        return false;
      }
      if (!secret) return false;
      zeroizeBytes(secret);
      await provisionReceiver(session, pubky);
      return (await StorageService.getLinkReceiver(pubky)) !== null;
    } catch (error) {
      if (error instanceof Error && error.name === "TabLockWriterError") return false;
      throw error;
    }
  })();
  healReceiverInFlight.set(pubky, run);
  void run.finally(() => {
    if (healReceiverInFlight.get(pubky) === run) healReceiverInFlight.delete(pubky);
  });
  return run;
}

export async function takeoverReceiver(
  session: SessionHandle,
  pubky: PubkyKey,
): Promise<ProvisionedReceiver> {
  if (session.pubky() !== pubky) {
    throw new Error("takeoverReceiver: session owner mismatch");
  }
  const receiverPath = assertValidReceiverPath(LINK_RECEIVER_PATH);
  const existing = await StorageService.getLinkReceiver(pubky);
  const alias = existing?.receiverAlias ?? RECEIVER_NOISE_ALIAS;
  const secret = await KeyStore.getReceiverNoiseSecret(alias);
  if (!secret) {
    throw new Error("takeoverReceiver: this device has no receiver secret");
  }
  let noisePublicKey: string;
  try {
    noisePublicKey = await PaykitLinkWeb.noisePublicKeyFromSecret(secret);
  } finally {
    zeroizeBytes(secret);
  }
  await publishOwnMarker(session, receiverPath, noisePublicKey);
  const reconciled = await inspectOwnPublishedMarker(pubky, receiverPath);
  if (reconciled.kind !== "present" || reconciled.noisePublicKey !== noisePublicKey) {
    await persistReceiverRow(pubky, receiverPath, false, "active", reconciled.kind === "present" ? reconciled.noisePublicKey : null);
    await retainPublishUnknown(pubky, noisePublicKey, await existingRetryAttempts(pubky));
    throw new Error("takeover marker publish was not confirmed");
  }
  try {
    await ensureChatKindsVReceiverJson(session, pubky, receiverPath, noisePublicKey);
  } catch (error) {
    await retainPublishUnknown(pubky, noisePublicKey, await existingRetryAttempts(pubky));
    throw error;
  }
  await StorageService.deleteLinkReceiverRetry(pubky);
  await persistReceiverRow(pubky, receiverPath, true, "active", noisePublicKey);
  await persistReceiverPath(pubky, receiverPath);
  setReceiverRoleState("active", TAKEOVER_TOAST);
  return { pubky, receiverPath, noisePublicKey, receiverRole: "active" };
}

export async function syncOwnReceiverRole(ownerPubky: PubkyKey): Promise<ReceiverRole | null> {
  const receiver = await StorageService.getLinkReceiver(ownerPubky);
  if (!receiver) return null;
  const secret = await KeyStore.getReceiverNoiseSecret(receiver.receiverAlias);
  if (!secret) return receiver.receiverRole;
  let localPk: string;
  try {
    localPk = await PaykitLinkWeb.noisePublicKeyFromSecret(secret);
  } finally {
    zeroizeBytes(secret);
  }
  let published: Awaited<ReturnType<typeof inspectOwnPublishedMarker>>;
  try {
    published = await inspectOwnPublishedMarker(ownerPubky, coerceReceiverPath(receiver.receiverPath));
  } catch {
    return receiver.receiverRole;
  }
  if (published.kind === "absent") {
    if (receiver.receiverRole === "active") {
      setReceiverRoleState("active", null, { needsReenable: true });
    }
    return receiver.receiverRole;
  }
  const role: ReceiverRole = published.noisePublicKey === localPk ? "active" : "standby";
  await persistReceiverRow(
    ownerPubky,
    receiver.receiverPath,
    role === "active" ? true : receiver.markerPublished,
    role,
    published.noisePublicKey,
  );
  setReceiverRoleState(role, null);
  return role;
}

export async function provisionLiveReceiver(): Promise<ProvisionedReceiver> {
  const live = getLiveSession();
  if (!live) {
    throw new Error("provisionReceiver: no live session");
  }
  return provisionReceiver(live.handle, live.pubky);
}

export async function drainReceiverPublishRetry(nowMs = Date.now()): Promise<boolean> {
  const live = getLiveSession();
  if (!live) return false;
  const retry = await StorageService.getLinkReceiverRetry(live.pubky);
  if (!retry) return false;
  if (retry.attempts >= MAX_ATTEMPTS) {
    await StorageService.deleteLinkReceiverRetry(retry.ownerPubky);
    return false;
  }
  if (retry.nextRetryAt > nowMs) return false;
  if (retry.ownerPubky !== live.handle.pubky()) {
    await StorageService.deleteLinkReceiverRetry(retry.ownerPubky);
    return false;
  }
  try {
    await provisionReceiver(live.handle, live.pubky);
    return true;
  } catch {
    return false;
  }
}

export async function takeoverLiveReceiver(): Promise<ProvisionedReceiver> {
  const { LinkService } = await import("./LinkService");
  return LinkService.takeOverReceiver();
}
