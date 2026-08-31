import { zeroizeBytes } from "@/lib/hex";
import { KeyStore } from "@/services/KeyStore";
import { StorageService } from "@/services/StorageService";
import {
  LINK_RECEIVER_PATH,
  assertValidReceiverPath,
} from "@/types/link";
import type { PubkyKey } from "@/types";
import { PaykitLinkWeb, type SessionHandle } from "./PaykitLinkWeb";
import { getLiveSession, persistReceiverPath } from "./session";

export const RECEIVER_NOISE_ALIAS = LINK_RECEIVER_PATH;
export const RECEIVER_MARKER_PUBLISH_BUDGET_MS = 15_000;

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
};

async function mintReceiver(
  ownerPubky: PubkyKey,
  receiverPath: string,
): Promise<{ noisePublicKey: string }> {
  const secret = await PaykitLinkWeb.generateNoiseSecretKey();
  try {
    await KeyStore.setReceiverNoiseSecret(RECEIVER_NOISE_ALIAS, secret);
    const noisePublicKey = await PaykitLinkWeb.noisePublicKeyFromSecret(secret);
    await StorageService.upsertLinkReceiver({
      ownerPubky,
      receiverAlias: RECEIVER_NOISE_ALIAS,
      receiverPath,
      markerPublished: false,
    });
    return { noisePublicKey };
  } finally {
    zeroizeBytes(secret);
  }
}

/**
 * Undo receiver state whose marker never landed.
 *
 * Enable status is derived from the receiver secret in the KeyStore, and when
 * session metadata carries no receiver path the lookup falls back to the
 * default alias — the very alias a mint writes. A secret left behind by a
 * failed publish therefore reads as "enabled" forever while no marker exists
 * for anyone to send to, and nothing ever retries. Rolling back keeps the
 * invariant that a stored receiver secret means a marker was published.
 *
 * Deleting the secret is safe even if a timed-out publish did eventually land:
 * the marker then advertises a key nobody holds, and re-running Enable mints a
 * fresh key and overwrites the marker.
 */
async function rollbackUnpublishedReceiver(ownerPubky: PubkyKey): Promise<void> {
  try {
    await KeyStore.deleteReceiverNoiseSecret(RECEIVER_NOISE_ALIAS);
  } catch {
    // Best effort. A surviving secret keeps the stale "enabled" reading, which
    // re-running Enable overwrites.
  }
  try {
    await StorageService.deleteLinkReceiver(ownerPubky);
  } catch {
    // Best effort. The row is rewritten by the next successful publish.
  }
}

export async function provisionReceiver(
  session: SessionHandle,
  pubky: PubkyKey,
): Promise<ProvisionedReceiver> {
  const receiverPath = assertValidReceiverPath(LINK_RECEIVER_PATH);
  await KeyStore.setPubky(pubky);
  const existing = await StorageService.getLinkReceiver(pubky);
  let noisePublicKey: string;
  // Whether a failed publish leaves nothing anyone depends on. Reusing a
  // receiver whose marker is already published must survive a failed re-publish,
  // because deleting that secret would break a receiver that works.
  let rollbackOnFailure = true;
  if (existing) {
    const secret = await KeyStore.getReceiverNoiseSecret(existing.receiverAlias);
    if (secret) {
      try {
        noisePublicKey = await PaykitLinkWeb.noisePublicKeyFromSecret(secret);
      } finally {
        zeroizeBytes(secret);
      }
      rollbackOnFailure = !existing.markerPublished;
    } else {
      await StorageService.deleteLinkReceiver(pubky);
      ({ noisePublicKey } = await mintReceiver(pubky, receiverPath));
    }
  } else {
    ({ noisePublicKey } = await mintReceiver(pubky, receiverPath));
  }
  try {
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
  } catch (error) {
    if (rollbackOnFailure) await rollbackUnpublishedReceiver(pubky);
    throw error;
  }
  await StorageService.upsertLinkReceiver({
    ownerPubky: pubky,
    receiverAlias: RECEIVER_NOISE_ALIAS,
    receiverPath,
    markerPublished: true,
  });
  await persistReceiverPath(pubky, receiverPath);
  return { pubky, receiverPath, noisePublicKey };
}

export async function provisionLiveReceiver(): Promise<ProvisionedReceiver> {
  const live = getLiveSession();
  if (!live) {
    throw new Error("provisionReceiver: no live session");
  }
  return provisionReceiver(live.handle, live.pubky);
}
