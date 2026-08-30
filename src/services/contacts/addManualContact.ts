import { createNexusClient } from "@/services/NexusClient";
import { StorageService } from "@/services/StorageService";
import type { Contact, PubkyKey } from "@/types";
import { parsePubky } from "@/utils/pubkyId";

export type AddManualContactResult =
  | { ok: true; contact: Contact }
  | { ok: false; reason: "invalid" | "self"; message: string };

export async function addManualContact(
  ownerPubky: PubkyKey,
  rawPeer: string,
): Promise<AddManualContactResult> {
  const peerPubky = parsePubky(rawPeer);
  if (!peerPubky) {
    return {
      ok: false,
      reason: "invalid",
      message: "Must be a 52-character z-base-32 pubky (no 0, 2, l, or v).",
    };
  }
  if (peerPubky === ownerPubky) {
    return { ok: false, reason: "self", message: "You cannot add your own pubky." };
  }

  const existing = await StorageService.getContact(peerPubky, ownerPubky);
  const ts = Date.now();
  let displayName = existing?.displayName;
  if (!displayName) {
    const nexus = createNexusClient();
    const profile = await nexus.user(peerPubky);
    if (profile.ok) {
      const name = profile.value.details?.name?.trim();
      if (name) displayName = name;
    }
  }

  const contact: Contact = {
    pubky: peerPubky,
    ownerPubky,
    trustScore: existing?.trustScore ?? 0,
    isFollowing: existing?.isFollowing ?? false,
    isFollower: existing?.isFollower ?? false,
    isMutual: existing?.isMutual ?? false,
    addedManually: true,
    firstSeenAt: existing?.firstSeenAt ?? ts,
    ...(existing?.homeserver ? { homeserver: existing.homeserver } : {}),
    ...(existing?.avatarHash ? { avatarHash: existing.avatarHash } : {}),
    ...(existing?.lastInteractionAt
      ? { lastInteractionAt: existing.lastInteractionAt }
      : {}),
    ...(displayName ? { displayName } : {}),
  };
  await StorageService.upsertContact(contact);
  const stored = (await StorageService.getContact(peerPubky, ownerPubky)) ?? contact;
  return { ok: true, contact: stored };
}
