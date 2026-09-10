import { StorageService } from "../StorageService";
import {
  CHAT_DELETE_KIND,
  CHAT_EDIT_KIND,
  CHAT_PIN_KIND,
  CHAT_RECEIPT_KIND,
  CHAT_REACTION_KIND,
  CHAT_TAG_KIND,
  CHAT_TYPING_KIND,
  buildDmConversationId,
} from "../../types/link";
import { GROUP_INVITE_KIND, GROUP_REACTION_KIND, peekEnvelopeKind } from "../../types/group";
import {
  CHAT_TAG_RATE_PER_MINUTE,
  dmScopeKey,
  normalizeChatTagLabel,
  parseChatDeleteV0,
  parseChatEditV0,
  parseChatGroupInviteV0,
  parseChatPinV0,
  parseChatReceiptV0,
  parseChatTagV0,
  parseChatTypingV0,
  type ChatKindParseCtx,
  type ChatKindParseReason,
  type ChatTagEnvelope,
  type ChatTagRow,
} from "../../types/chatKinds";
import type { PubkyKey } from "../../types";

const tagRate = new Map<string, number[]>();

function noteTagRate(ownerPubky: string, tagger: string, now: number): boolean {
  const key = `${ownerPubky}:${tagger}`;
  const windowStart = now - 60_000;
  const stamps = (tagRate.get(key) ?? []).filter((ts) => ts >= windowStart);
  if (stamps.length >= CHAT_TAG_RATE_PER_MINUTE) {
    tagRate.set(key, stamps);
    return false;
  }
  stamps.push(now);
  tagRate.set(key, stamps);
  return true;
}

export type ChatKindApplyOutcome =
  | "applied"
  | "processed"
  | "deferred"
  | "unprocessed"
  | { error: ChatKindParseReason };

function ctxFor(ownerPubky: PubkyKey, senderPubky: PubkyKey): ChatKindParseCtx {
  return { ownerPubky, senderPubky, peerTrust: "accepted" };
}

function tagRowFromEnvelope(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  envelope: ChatTagEnvelope,
  peerPubky: PubkyKey,
): ChatTagRow {
  const channelId = envelope.channel_id ?? null;
  const conversationId = channelId ? null : buildDmConversationId(peerPubky);
  return {
    ownerPubky,
    conversationId,
    channelId,
    scopeKey: channelId ?? dmScopeKey(peerPubky),
    targetEventId: envelope.target_event_id,
    targetAuthorPubky: envelope.target_author_pubky,
    taggerPubky: senderPubky,
    label: envelope.label,
    createdAt: envelope.sent_at,
  };
}

async function senderIsActiveMember(
  ownerPubky: PubkyKey,
  channelId: string,
  senderPubky: PubkyKey,
): Promise<boolean> {
  const member = await StorageService.getGroupMember(ownerPubky, channelId, senderPubky);
  return member?.status === "active";
}

async function targetExists(
  ownerPubky: PubkyKey,
  peerPubky: PubkyKey,
  envelope: { target_event_id: string; target_author_pubky: string; channel_id?: string },
): Promise<boolean> {
  if (envelope.channel_id) {
    const row = await StorageService.getGroupMessage(
      ownerPubky,
      envelope.channel_id,
      envelope.target_author_pubky,
      envelope.target_event_id,
    );
    return Boolean(row && !row.deleted);
  }
  const conversationId = buildDmConversationId(peerPubky);
  const row = await StorageService.findLinkMessageInConversation(
    ownerPubky,
    conversationId,
    envelope.target_event_id,
  );
  return Boolean(row && row.senderPubky === envelope.target_author_pubky);
}

export async function applyChatTagAliasFromReaction(input: {
  ownerPubky: PubkyKey;
  senderPubky: PubkyKey;
  peerPubky: PubkyKey;
  emoji: string;
  targetEventId: string;
  targetAuthorPubky: string;
  channelId?: string;
  sentAt: number;
}): Promise<void> {
  const label = normalizeChatTagLabel(input.emoji);
  if (label === null) return;
  const envelope: ChatTagEnvelope = {
    version: 1,
    kind: CHAT_TAG_KIND,
    event_id: "00000000-0000-4000-8000-000000000000",
    sent_at: input.sentAt,
    target_event_id: input.targetEventId,
    target_author_pubky: input.targetAuthorPubky,
    label,
    op: "add",
    channel_id: input.channelId,
  };
  await applyTagEnvelope(input.ownerPubky, input.senderPubky, input.peerPubky, envelope);
}

async function applyTagEnvelope(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  peerPubky: PubkyKey,
  envelope: ChatTagEnvelope,
): Promise<"applied" | "deferred" | "processed" | { error: ChatKindParseReason }> {
  if (envelope.channel_id && !(await senderIsActiveMember(ownerPubky, envelope.channel_id, senderPubky))) {
    return { error: "not-member" };
  }
  if (!(await targetExists(ownerPubky, peerPubky, envelope))) return "deferred";
  if (envelope.op === "remove") {
    await StorageService.deleteChatTag({
      ownerPubky,
      scopeKey: envelope.channel_id ?? dmScopeKey(peerPubky),
      targetAuthorPubky: envelope.target_author_pubky,
      targetEventId: envelope.target_event_id,
      taggerPubky: senderPubky,
      label: envelope.label,
    });
    return "applied";
  }
  if (!noteTagRate(ownerPubky, senderPubky, Date.now())) return "processed";
  await StorageService.upsertChatTag(tagRowFromEnvelope(ownerPubky, senderPubky, envelope, peerPubky));
  return "applied";
}

async function applyReceiptEnvelope(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  envelope: { status: "delivered" | "read"; event_ids: string[]; channel_id?: string },
): Promise<"applied" | { error: ChatKindParseReason }> {
  if (envelope.channel_id && !(await senderIsActiveMember(ownerPubky, envelope.channel_id, senderPubky))) {
    return { error: "not-member" };
  }
  const next = envelope.status === "read" ? "read" : "delivered";
  let applied = 0;
  let selfOnly = true;
  const conversationId = buildDmConversationId(senderPubky);
  for (const eventId of envelope.event_ids) {
    const target = envelope.channel_id
      ? await StorageService.findGroupMessageByEventId(ownerPubky, envelope.channel_id, eventId)
      : await StorageService.findLinkMessageInConversation(ownerPubky, conversationId, eventId);
    if (!target) continue;
    if (target.senderPubky === senderPubky) continue;
    selfOnly = false;
    if (target.senderPubky !== ownerPubky) continue;
    await StorageService.upgradeMessageDelivery(ownerPubky, eventId, next, envelope.channel_id);
    applied += 1;
  }
  if (applied === 0 && selfOnly) return { error: "wrong-author" };
  return "applied";
}

export async function applyKnownChatKind(input: {
  ownerPubky: PubkyKey;
  senderPubky: PubkyKey;
  peerPubky: PubkyKey;
  rawJson: string;
}): Promise<ChatKindApplyOutcome> {
  const kind = peekEnvelopeKind(input.rawJson);
  const ctx = ctxFor(input.ownerPubky, input.senderPubky);
  if (kind === CHAT_TAG_KIND) {
    const parsed = parseChatTagV0(input.rawJson, ctx);
    if ("error" in parsed) return { error: parsed.error };
    return applyTagEnvelope(input.ownerPubky, input.senderPubky, input.peerPubky, parsed.ok);
  }
  if (kind === CHAT_REACTION_KIND) {
    const parsed = parseChatReactionAlias(input.rawJson, ctx);
    if ("error" in parsed) return { error: parsed.error };
    return applyTagEnvelope(input.ownerPubky, input.senderPubky, input.peerPubky, parsed.ok);
  }
  if (kind === CHAT_RECEIPT_KIND) {
    const parsed = parseChatReceiptV0(input.rawJson, ctx);
    if ("error" in parsed) return { error: parsed.error };
    return applyReceiptEnvelope(input.ownerPubky, input.senderPubky, parsed.ok);
  }
  if (kind === CHAT_TYPING_KIND) {
    const parsed = parseChatTypingV0(input.rawJson, ctx);
    if ("error" in parsed) return { error: parsed.error };
    return "processed";
  }
  if (kind === CHAT_EDIT_KIND) {
    const parsed = parseChatEditV0(input.rawJson, ctx);
    if ("error" in parsed) return { error: parsed.error };
    return "processed";
  }
  if (kind === CHAT_DELETE_KIND) {
    const parsed = parseChatDeleteV0(input.rawJson, ctx);
    if ("error" in parsed) return { error: parsed.error };
    return applyDeleteEnvelope(input.ownerPubky, input.senderPubky, input.peerPubky, parsed.ok);
  }
  if (kind === CHAT_PIN_KIND) {
    const parsed = parseChatPinV0(input.rawJson, ctx);
    if ("error" in parsed) return { error: parsed.error };
    return "processed";
  }
  if (kind === GROUP_INVITE_KIND) {
    const parsed = parseChatGroupInviteV0(input.rawJson, ctx);
    if ("error" in parsed) return { error: parsed.error };
    return "processed";
  }
  return "unprocessed";
}

async function applyDeleteEnvelope(
  ownerPubky: PubkyKey,
  senderPubky: PubkyKey,
  peerPubky: PubkyKey,
  envelope: { target_event_id: string },
): Promise<"applied" | "processed" | "deferred" | { error: ChatKindParseReason }> {
  const conversationId = buildDmConversationId(peerPubky);
  const target = await StorageService.findLinkMessageInConversation(
    ownerPubky,
    conversationId,
    envelope.target_event_id,
  );
  if (!target) return "deferred";
  if (target.senderPubky !== senderPubky) return { error: "wrong-author" };
  await StorageService.tombstoneLinkMessage({
    ownerPubky,
    conversationId,
    eventId: target.eventId,
    senderPubky,
  });
  return "applied";
}

function parseChatReactionAlias(
  rawJson: string,
  ctx: ChatKindParseCtx,
): ReturnType<typeof parseChatTagV0> {
  let value: unknown;
  try {
    value = JSON.parse(rawJson);
  } catch {
    return { error: "not-json" };
  }
  if (typeof value !== "object" || value === null) return { error: "not-json" };
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== CHAT_REACTION_KIND && candidate.kind !== GROUP_REACTION_KIND) {
    return { error: "wrong-kind" };
  }
  const mapped = {
    version: 1,
    kind: CHAT_TAG_KIND,
    event_id: candidate.event_id,
    sent_at: candidate.sent_at,
    target_event_id: candidate.target_event_id,
    target_author_pubky: candidate.target_author_pubky,
    label: candidate.emoji,
    op: "add",
    ...(typeof candidate.channel_id === "string" ? { channel_id: candidate.channel_id } : {}),
  };
  return parseChatTagV0(JSON.stringify(mapped), ctx);
}

export { parseChatReactionAlias };
