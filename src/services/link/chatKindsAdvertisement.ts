import type { PubkyKey } from "../../types";
import {
  CAPABILITY_MAX_BYTES,
  CHAT_KINDS_V,
  capabilityPath,
  buildCapabilitiesJson,
  LEGACY_RECEIVER_JSON_STORAGE_PATH,
  normalizeChatKindsV,
  parseCapabilitiesJson,
  parseLegacyChatKindsVDetailed,
} from "../../types/receiverMarker";
import { StorageService } from "../StorageService";
import { PaykitLinkWeb, type ReceiverMarker, type SessionHandle } from "./PaykitLinkWeb";

const chatKindsUpgradeReplayed = new Set<string>();
export const CAPABILITY_REQUEST_BUDGET_MS = 15_000;

function withCapabilityBudget<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error("capability request timed out"), { capabilityFailure: "transient" })),
        CAPABILITY_REQUEST_BUDGET_MS,
      );
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function terminalCapabilityError(message: string): Error {
  return Object.assign(new Error(message), { capabilityFailure: "terminal" });
}

export function isTerminalCapabilityFailure(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "capabilityFailure" in error &&
      error.capabilityFailure === "terminal",
  );
}

export function resetChatKindsUpgradeReplayedForTests(): void {
  chatKindsUpgradeReplayed.clear();
}

export async function putChatKindsVReceiverJson(
  session: SessionHandle,
  noisePublicKey: string,
): Promise<void> {
  const body = buildCapabilitiesJson();
  await withCapabilityBudget(
    PaykitLinkWeb.putPublic(
      session,
      capabilityPath(noisePublicKey),
      new TextEncoder().encode(body),
    ),
  );
}

export async function readChatKindsCapability(
  peerPubky: PubkyKey,
  noisePublicKey: string,
): Promise<{ kind: "absent" | "valid" | "invalid" | "too-large"; chatKindsV: number }> {
  try {
    const bytes = await withCapabilityBudget(
      PaykitLinkWeb.publicGet(peerPubky, capabilityPath(noisePublicKey)),
    );
    if (!bytes) return { kind: "absent", chatKindsV: 0 };
    if (bytes.byteLength > CAPABILITY_MAX_BYTES) return { kind: "too-large", chatKindsV: 0 };
    const parsed = parseCapabilitiesJson(new TextDecoder().decode(bytes));
    return parsed
      ? { kind: "valid", chatKindsV: parsed.chatKindsV }
      : { kind: "invalid", chatKindsV: 0 };
  } catch {
    throw new Error("capability unavailable");
  }
}

export async function ensureChatKindsVReceiverJson(
  session: SessionHandle,
  ownerPubky: PubkyKey,
  receiverPath: string,
  noisePublicKey: string,
): Promise<void> {
  const marker = await withCapabilityBudget(
    PaykitLinkWeb.getReceiverMarker(ownerPubky, receiverPath),
  );
  if (!marker || marker.noisePublicKey !== noisePublicKey) {
    throw terminalCapabilityError("receiver marker changed before capability publish");
  }
  const current = await readChatKindsCapability(ownerPubky, noisePublicKey);
  if (current.kind === "valid" && current.chatKindsV >= CHAT_KINDS_V) return;
  if (current.kind === "invalid" || current.kind === "too-large") {
    throw terminalCapabilityError("invalid capability document");
  }
  await putChatKindsVReceiverJson(session, noisePublicKey);
  const [reconciledCapability, reconciledMarker] = await Promise.all([
    readChatKindsCapability(ownerPubky, noisePublicKey),
    withCapabilityBudget(PaykitLinkWeb.getReceiverMarker(ownerPubky, receiverPath)),
  ]);
  if (!reconciledMarker || reconciledMarker.noisePublicKey !== noisePublicKey) {
    throw terminalCapabilityError("capability publish was not confirmed");
  }
  if (reconciledCapability.kind !== "valid" || reconciledCapability.chatKindsV < CHAT_KINDS_V) {
    throw new Error("capability publish was not confirmed");
  }
}

export async function resolvePeerChatKindsV(
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  ownerPubky?: PubkyKey,
): Promise<number> {
  const result = await resolvePeerChatKindsVResult(peerPubky, marker, ownerPubky);
  return result.value;
}

type PeerChatKindsVResult = { available: boolean; value: number };

async function resolvePeerChatKindsVResult(
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  ownerPubky?: PubkyKey,
): Promise<PeerChatKindsVResult> {
  try {
    const capability = await readChatKindsCapability(peerPubky, marker.noisePublicKey);
    if (capability.kind !== "absent") return { available: true, value: capability.chatKindsV };
  } catch {
    if (ownerPubky) {
      const stored = await StorageService.getLink(ownerPubky, peerPubky);
      return { available: false, value: normalizeChatKindsV(stored?.chatKindsV) };
    }
    return { available: false, value: 0 };
  }
  try {
    const legacy = await withCapabilityBudget(
      PaykitLinkWeb.publicGet(peerPubky, LEGACY_RECEIVER_JSON_STORAGE_PATH),
    );
    if (!legacy) return { available: true, value: 0 };
    const value = parseLegacyChatKindsVDetailed(new TextDecoder().decode(legacy));
    return value === null ? { available: false, value: 0 } : { available: true, value };
  } catch {
    if (ownerPubky) {
      const stored = await StorageService.getLink(ownerPubky, peerPubky);
      return { available: false, value: normalizeChatKindsV(stored?.chatKindsV) };
    }
    return { available: false, value: 0 };
  }
}

export async function persistPeerChatKindsVFromMarker(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  marker: ReceiverMarker,
  onUpgrade: (owner: PubkyKey, peer: PubkyKey) => Promise<void>,
): Promise<number> {
  const stored = await StorageService.getLink(ownerPubky, peerPubky);
  const prev = stored ? normalizeChatKindsV(stored.chatKindsV) : 0;
  const resolved = await resolvePeerChatKindsVResult(peerPubky, marker, ownerPubky);
  if (!resolved.available) return prev;
  const next = resolved.value;
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
