import { KeyStore } from "@/services/KeyStore";
import { StorageService } from "@/services/StorageService";
import {
  LINK_RECEIVER_PATH,
  assertValidReceiverPath,
} from "@/types/link";
import type { PubkyKey } from "@/types";
import { PaykitLinkWeb, type SessionHandle } from "./PaykitLinkWeb";
import { getLiveSession } from "./session";

export const RECEIVER_NOISE_ALIAS = LINK_RECEIVER_PATH;

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
  await KeyStore.setReceiverNoiseSecret(RECEIVER_NOISE_ALIAS, secret);
  const noisePublicKey = await PaykitLinkWeb.noisePublicKeyFromSecret(secret);
  await StorageService.upsertLinkReceiver({
    ownerPubky,
    receiverAlias: RECEIVER_NOISE_ALIAS,
    receiverPath,
    markerPublished: false,
  });
  return { noisePublicKey };
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
      noisePublicKey = await PaykitLinkWeb.noisePublicKeyFromSecret(secret);
    } else {
      await StorageService.deleteLinkReceiver(pubky);
      ({ noisePublicKey } = await mintReceiver(pubky, receiverPath));
    }
  } else {
    ({ noisePublicKey } = await mintReceiver(pubky, receiverPath));
  }
  await PaykitLinkWeb.publishReceiverMarker(
    session,
    receiverPath,
    noisePublicKey,
    true,
    false,
    false,
    false,
  );
  await StorageService.upsertLinkReceiver({
    ownerPubky: pubky,
    receiverAlias: RECEIVER_NOISE_ALIAS,
    receiverPath,
    markerPublished: true,
  });
  return { pubky, receiverPath, noisePublicKey };
}

export async function provisionLiveReceiver(): Promise<ProvisionedReceiver> {
  const live = getLiveSession();
  if (!live) {
    throw new Error("provisionReceiver: no live session");
  }
  return provisionReceiver(live.handle, live.pubky);
}
