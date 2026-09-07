import type { PubkyKey } from "../../types";
import {
  CHAT_KINDS_V,
  RECEIVER_JSON_STORAGE_PATH,
  buildReceiverMarkerPutBody,
  chatKindsVFromMarker,
  normalizeChatKindsV,
  parseReceiverMarkerJson,
} from "../../types/receiverMarker";
import { StorageService } from "../StorageService";
import { PaykitLinkWeb, type ReceiverMarker, type SessionHandle } from "./PaykitLinkWeb";

const chatKindsUpgradeReplayed = new Set<string>();

export function resetChatKindsUpgradeReplayedForTests(): void {
  chatKindsUpgradeReplayed.clear();
}

export async function putChatKindsVReceiverJson(
  session: SessionHandle,
  noisePublicKey: string,
): Promise<void> {
  const body = buildReceiverMarkerPutBody({ noisePublicKey });
  await PaykitLinkWeb.putPublic(
    session,
    RECEIVER_JSON_STORAGE_PATH,
    new TextEncoder().encode(body),
  );
}

async function fetchPeerReceiverJsonChatKindsV(peerPubky: PubkyKey): Promise<number> {
  try {
    const bytes = await PaykitLinkWeb.publicGet(peerPubky, RECEIVER_JSON_STORAGE_PATH);
    if (!bytes || bytes.length === 0) return 0;
    const parsed = parseReceiverMarkerJson(new TextDecoder().decode(bytes));
    return parsed?.chatKindsV ?? 0;
  } catch {
    return 0;
  }
}

export async function resolvePeerChatKindsV(
  peerPubky: PubkyKey,
  marker: ReceiverMarker & { chatKindsV?: unknown },
): Promise<number> {
  const fromMarker = chatKindsVFromMarker(marker);
  if (fromMarker >= 1) return fromMarker;
  return fetchPeerReceiverJsonChatKindsV(peerPubky);
}

export async function persistPeerChatKindsVFromMarker(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker & { chatKindsV?: unknown },
  onUpgrade: (owner: PubkyKey, peer: PubkyKey) => Promise<void>,
): Promise<number> {
  const next = await resolvePeerChatKindsV(peerPubky, marker);
  const stored = await StorageService.getLink(ownerPubky, peerPubky);
  const prev = stored ? normalizeChatKindsV(stored.chatKindsV) : 0;
  await StorageService.recordPeerChatKindsV(ownerPubky, peerPubky, next);
  const upgradeKey = `${ownerPubky}:${peerPubky}`;
  if (prev < CHAT_KINDS_V && next >= CHAT_KINDS_V && !chatKindsUpgradeReplayed.has(upgradeKey)) {
    chatKindsUpgradeReplayed.add(upgradeKey);
    queueMicrotask(() => {
      void onUpgrade(ownerPubky, peerPubky);
    });
  }
  return next;
}
