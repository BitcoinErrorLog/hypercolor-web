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

export async function provisionReceiver(
  session: SessionHandle,
  pubky: PubkyKey,
): Promise<ProvisionedReceiver> {
  const receiverPath = assertValidReceiverPath(LINK_RECEIVER_PATH);
  await KeyStore.setPubky(pubky);
  const existing = await StorageService.getLinkReceiver(pubky);
  let noisePublicKey: string;
  if (existing) {
    const secret = await KeyStore.getReceiverNoiseSecret(existing.receiverAlias);
    if (secret) {
      try {
        noisePublicKey = await PaykitLinkWeb.noisePublicKeyFromSecret(secret);
      } finally {
        zeroizeBytes(secret);
      }
    } else {
      await StorageService.deleteLinkReceiver(pubky);
      ({ noisePublicKey } = await mintReceiver(pubky, receiverPath));
    }
  } else {
    ({ noisePublicKey } = await mintReceiver(pubky, receiverPath));
  }
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
