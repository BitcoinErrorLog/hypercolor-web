import {
  decodeGroupEnvelope,
  GROUP_MEMBERSHIP_KIND,
  parsePrivateChannelId,
} from "@/types/group";
import type { MessageRequest } from "@/types";

export type HeldGroupInvitation = {
  channelId: string;
  name: string | null;
  founderPubky: string;
};

/** Pending or declined founders stay out of channels/inbox until (re)accepted. */
export function heldGroupFounderSet(
  requests: readonly Pick<MessageRequest, "peerPubky" | "status">[],
): Set<string> {
  const out = new Set<string>();
  for (const request of requests) {
    if (request.status === "pending" || request.status === "declined") {
      out.add(request.peerPubky);
    }
  }
  return out;
}

export function isHeldFounderChannel(channelId: string, heldFounders: Set<string>): boolean {
  const bound = parsePrivateChannelId(channelId);
  return bound !== null && heldFounders.has(bound.founderPubky);
}

export function excludeHeldFounderChannels<T extends { channelId: string }>(
  channels: readonly T[],
  heldFounders: Set<string>,
): T[] {
  return channels.filter((channel) => !isHeldFounderChannel(channel.channelId, heldFounders));
}

/**
 * Name-only invitation from a held peer's unprocessed group stream.
 * Message bodies are never returned.
 */
export function peekGroupInvitation(
  rawJson: string,
  senderPubky: string,
): HeldGroupInvitation | null {
  const envelope = decodeGroupEnvelope(rawJson);
  if (!envelope) return null;
  const bound = parsePrivateChannelId(envelope.channel_id);
  if (!bound || bound.founderPubky !== senderPubky) return null;
  let name: string | null = null;
  if (envelope.kind === GROUP_MEMBERSHIP_KIND && envelope.op === "create") {
    const trimmed = envelope.name?.trim();
    name = trimmed && trimmed.length > 0 ? trimmed : null;
  }
  return {
    channelId: envelope.channel_id,
    name,
    founderPubky: bound.founderPubky,
  };
}

export function collectGroupInvitations(
  items: readonly { rawJson: string }[],
  senderPubky: string,
): HeldGroupInvitation[] {
  const byId = new Map<string, HeldGroupInvitation>();
  for (const item of items) {
    const invite = peekGroupInvitation(item.rawJson, senderPubky);
    if (!invite) continue;
    const prev = byId.get(invite.channelId);
    if (!prev || (!prev.name && invite.name)) {
      byId.set(invite.channelId, invite);
    }
  }
  return [...byId.values()];
}
