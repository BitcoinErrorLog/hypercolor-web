import {
  CHAT_DELETE_KIND,
  CHAT_EDIT_KIND,
  CHAT_PIN_KIND,
  CHAT_RECEIPT_KIND,
  CHAT_REACTION_KIND,
  CHAT_TAG_KIND,
  CHAT_TYPING_KIND,
  LINK_MESSAGE_MAX_BYTES,
  parseLinkSentAt,
} from "./link";
import { GROUP_INVITE_KIND, parseFounderBoundChannelId } from "./group";
import { isInvisibleOrControlCodePoint } from "../utils/displaySanitize";

export const CHAT_KIND_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CHAT_KIND_PUBKY_LENGTH = 52;
export const CHAT_KIND_WORD_LABEL = /^[a-z0-9_]{1,32}$/;
export const CHAT_RECEIPT_EVENT_IDS_CAP = 16;
export const CHAT_TAG_LABEL_UTF8_MAX = 32;
export const CHAT_LWW_FUTURE_CLAMP_MS = 5 * 60 * 1000;
export const CHAT_TAG_LIVE_CAP_PER_TARGET = 20;
export const CHAT_TAG_RATE_PER_MINUTE = 100;

export type ChatKindParseReason =
  | "not-json"
  | "oversized"
  | "unknown-kind"
  | "wrong-kind"
  | "bad-version"
  | "bad-event-id"
  | "bad-sent-at"
  | "bad-channel-id"
  | "bad-target-id"
  | "bad-pubky"
  | "invalid-label"
  | "invalid-op"
  | "invalid-status"
  | "invalid-event-ids"
  | "event-ids-cap"
  | "invalid-state"
  | "empty-body"
  | "invalid-mentions"
  | "reply-fields-mismatch"
  | "cross-context"
  | "wrong-author"
  | "not-member"
  | "not-admin"
  | "not-editable"
  | "not-deletable"
  | "gated-peer"
  | "expired";

export type ChatKindParseCtx = {
  senderPubky: string;
  ownerPubky: string;
  peerTrust: "accepted" | "gated";
  now?: number;
};

export type ChatKindParseResult<T> =
  | { ok: T }
  | { error: ChatKindParseReason };

export type ChatTagEnvelope = {
  version: 1;
  kind: typeof CHAT_TAG_KIND;
  event_id: string;
  sent_at: number;
  target_event_id: string;
  target_author_pubky: string;
  label: string;
  op: "add" | "remove";
  channel_id?: string;
};

export type ChatReceiptEnvelope = {
  version: 1;
  kind: typeof CHAT_RECEIPT_KIND;
  event_id: string;
  sent_at: number;
  status: "delivered" | "read";
  event_ids: string[];
  channel_id?: string;
};

export type ChatTypingEnvelope = {
  version: 1;
  kind: typeof CHAT_TYPING_KIND;
  event_id: string;
  sent_at: number;
  state: "start" | "stop";
  channel_id?: string;
};

export type ChatEditEnvelope = {
  version: 1;
  kind: typeof CHAT_EDIT_KIND;
  event_id: string;
  sent_at: number;
  target_event_id: string;
  body: string;
  mentions?: ChatMention[];
};

export type ChatDeleteEnvelope = {
  version: 1;
  kind: typeof CHAT_DELETE_KIND;
  event_id: string;
  sent_at: number;
  target_event_id: string;
};

export type ChatPinEnvelope = {
  version: 1;
  kind: typeof CHAT_PIN_KIND;
  event_id: string;
  sent_at: number;
  target_event_id: string;
  target_author_pubky: string;
  op: "set" | "clear";
  channel_id?: string;
};

export type ChatGroupInviteEnvelope = {
  version: 1;
  kind: typeof GROUP_INVITE_KIND;
  event_id: string;
  sent_at: number;
  channel_id: string;
  invite_id: string;
  name: string;
  expires_at: number;
};

export type ChatMention = { pubky: string; start: number; end: number };

export type ChatTagRow = {
  ownerPubky: string;
  conversationId: string | null;
  channelId: string | null;
  scopeKey: string;
  targetEventId: string;
  targetAuthorPubky: string;
  taggerPubky: string;
  label: string;
  createdAt: number;
};

export type ChatTagAggregate = {
  label: string;
  count: number;
  mine: boolean;
};

export type ChatDevicePrefs = {
  ownerPubky: string;
  receiptsEnabled: boolean;
  typingEnabled: boolean;
  upgradeAt: number;
  updatedAt: number;
};

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function serializedUtf8Bytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value));
}

export function isChatKindUuid(value: string): boolean {
  return CHAT_KIND_UUID.test(value);
}

export function isChatKindPubky(value: string): boolean {
  return value.length === CHAT_KIND_PUBKY_LENGTH;
}

export function isLinkSentAtUnixMs(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isFutureLwwSentAt(sentAt: number, now = Date.now()): boolean {
  return sentAt > now + CHAT_LWW_FUTURE_CLAMP_MS;
}

export function nfcTrim(value: string): string {
  return value.normalize("NFC").trim();
}

function graphemeCount(value: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length;
  }
  return [...value].length;
}

function isAllowedEmojiTagLabel(label: string): boolean {
  if (graphemeCount(label) !== 1) return false;
  for (const ch of label) {
    const code = ch.codePointAt(0);
    if (code === undefined) return false;
    if (code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f)) continue;
    if (isInvisibleOrControlCodePoint(code)) return false;
  }
  return /\p{Extended_Pictographic}/u.test(label);
}

export function normalizeChatTagLabel(raw: string): string | null {
  const label = nfcTrim(raw);
  if (label.length === 0) return null;
  if (CHAT_KIND_WORD_LABEL.test(label)) {
    if (utf8Bytes(label) > CHAT_TAG_LABEL_UTF8_MAX) return null;
    return label;
  }
  if (utf8Bytes(label) > CHAT_TAG_LABEL_UTF8_MAX) return null;
  if (/[A-Za-z0-9_]/.test(label) && !CHAT_KIND_WORD_LABEL.test(label)) return null;
  if (!isAllowedEmojiTagLabel(label)) return null;
  return label;
}

function asRecord(rawJson: string): ChatKindParseResult<Record<string, unknown>> {
  if (utf8Bytes(rawJson) > LINK_MESSAGE_MAX_BYTES) return { error: "oversized" };
  let value: unknown;
  try {
    value = JSON.parse(rawJson);
  } catch {
    return { error: "not-json" };
  }
  if (typeof value !== "object" || value === null) return { error: "not-json" };
  return { ok: value as Record<string, unknown> };
}

function readCommon(
  candidate: Record<string, unknown>,
  expectedKind: string,
  ctx: ChatKindParseCtx,
): ChatKindParseResult<{ eventId: string; sentAt: number; channelId?: string }> {
  if (ctx.peerTrust === "gated") return { error: "gated-peer" };
  if (candidate.version !== 1) return { error: "bad-version" };
  if (typeof candidate.kind !== "string") return { error: "unknown-kind" };
  if (candidate.kind !== expectedKind) return { error: "wrong-kind" };
  if (typeof candidate.event_id !== "string" || !isChatKindUuid(candidate.event_id)) {
    return { error: "bad-event-id" };
  }
  const sentAt = parseLinkSentAt(candidate.sent_at);
  if (sentAt === null || !isLinkSentAtUnixMs(sentAt)) return { error: "bad-sent-at" };
  if (candidate.channel_id !== undefined) {
    if (typeof candidate.channel_id !== "string" || !parseFounderBoundChannelId(candidate.channel_id)) {
      return { error: "bad-channel-id" };
    }
    return { ok: { eventId: candidate.event_id, sentAt, channelId: candidate.channel_id } };
  }
  return { ok: { eventId: candidate.event_id, sentAt } };
}

export function parseChatTagV0(
  raw: string,
  ctx: ChatKindParseCtx,
): ChatKindParseResult<ChatTagEnvelope> {
  const record = asRecord(raw);
  if ("error" in record) return record;
  const common = readCommon(record.ok, CHAT_TAG_KIND, ctx);
  if ("error" in common) return common;
  if (isFutureLwwSentAt(common.ok.sentAt, ctx.now)) return { error: "bad-sent-at" };
  if (typeof record.ok.target_event_id !== "string" || !isChatKindUuid(record.ok.target_event_id)) {
    return { error: "bad-target-id" };
  }
  if (typeof record.ok.target_author_pubky !== "string" || !isChatKindPubky(record.ok.target_author_pubky)) {
    return { error: "bad-pubky" };
  }
  if (record.ok.op !== "add" && record.ok.op !== "remove") return { error: "invalid-op" };
  if (typeof record.ok.label !== "string") return { error: "invalid-label" };
  const label = normalizeChatTagLabel(record.ok.label);
  if (label === null) return { error: "invalid-label" };
  const envelope: ChatTagEnvelope = {
    version: 1,
    kind: CHAT_TAG_KIND,
    event_id: common.ok.eventId,
    sent_at: common.ok.sentAt,
    target_event_id: record.ok.target_event_id,
    target_author_pubky: record.ok.target_author_pubky,
    label,
    op: record.ok.op,
  };
  if (common.ok.channelId) envelope.channel_id = common.ok.channelId;
  return { ok: envelope };
}

export function parseChatReceiptV0(
  raw: string,
  ctx: ChatKindParseCtx,
): ChatKindParseResult<ChatReceiptEnvelope> {
  const record = asRecord(raw);
  if ("error" in record) return record;
  const common = readCommon(record.ok, CHAT_RECEIPT_KIND, ctx);
  if ("error" in common) return common;
  if (record.ok.status !== "delivered" && record.ok.status !== "read") {
    return { error: "invalid-status" };
  }
  if (!Array.isArray(record.ok.event_ids)) return { error: "invalid-event-ids" };
  const ids: string[] = [];
  for (const item of record.ok.event_ids) {
    if (typeof item !== "string" || !isChatKindUuid(item)) return { error: "invalid-event-ids" };
    ids.push(item);
  }
  if (ids.length < 1) return { error: "invalid-event-ids" };
  if (ids.length > CHAT_RECEIPT_EVENT_IDS_CAP) return { error: "event-ids-cap" };
  const unique = new Set(ids);
  if (unique.size !== ids.length) return { error: "invalid-event-ids" };
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < ids.length; i += 1) {
    if (ids[i] !== sorted[i]) return { error: "invalid-event-ids" };
  }
  const envelope: ChatReceiptEnvelope = {
    version: 1,
    kind: CHAT_RECEIPT_KIND,
    event_id: common.ok.eventId,
    sent_at: common.ok.sentAt,
    status: record.ok.status,
    event_ids: ids,
  };
  if (common.ok.channelId) envelope.channel_id = common.ok.channelId;
  return { ok: envelope };
}

export function parseChatTypingV0(
  raw: string,
  ctx: ChatKindParseCtx,
): ChatKindParseResult<ChatTypingEnvelope> {
  const record = asRecord(raw);
  if ("error" in record) return record;
  const common = readCommon(record.ok, CHAT_TYPING_KIND, ctx);
  if ("error" in common) return common;
  if (record.ok.state !== "start" && record.ok.state !== "stop") return { error: "invalid-state" };
  const envelope: ChatTypingEnvelope = {
    version: 1,
    kind: CHAT_TYPING_KIND,
    event_id: common.ok.eventId,
    sent_at: common.ok.sentAt,
    state: record.ok.state,
  };
  if (common.ok.channelId) envelope.channel_id = common.ok.channelId;
  return { ok: envelope };
}

function readMentions(body: string, value: unknown): ChatKindParseResult<ChatMention[] | undefined> {
  if (value === undefined) return { ok: undefined };
  if (!Array.isArray(value) || value.length > 8) return { error: "invalid-mentions" };
  const mentions: ChatMention[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return { error: "invalid-mentions" };
    const row = item as Record<string, unknown>;
    if (typeof row.pubky !== "string" || !isChatKindPubky(row.pubky)) return { error: "invalid-mentions" };
    if (typeof row.start !== "number" || typeof row.end !== "number") return { error: "invalid-mentions" };
    if (!Number.isInteger(row.start) || !Number.isInteger(row.end)) return { error: "invalid-mentions" };
    if (!(row.start >= 0 && row.start < row.end && row.end <= body.length)) return { error: "invalid-mentions" };
    if (isSurrogateSplit(body, row.start) || isSurrogateSplit(body, row.end)) {
      return { error: "invalid-mentions" };
    }
    mentions.push({ pubky: row.pubky, start: row.start, end: row.end });
  }
  const ordered = [...mentions].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i]!.start < ordered[i - 1]!.end) return { error: "invalid-mentions" };
  }
  return { ok: mentions };
}

function isSurrogateSplit(body: string, index: number): boolean {
  if (index <= 0 || index >= body.length) return false;
  const code = body.charCodeAt(index - 1);
  return code >= 0xd800 && code <= 0xdbff;
}

export function parseChatEditV0(
  raw: string,
  ctx: ChatKindParseCtx,
): ChatKindParseResult<ChatEditEnvelope> {
  const record = asRecord(raw);
  if ("error" in record) return record;
  const common = readCommon(record.ok, CHAT_EDIT_KIND, ctx);
  if ("error" in common) return common;
  if (isFutureLwwSentAt(common.ok.sentAt, ctx.now)) return { error: "bad-sent-at" };
  if (typeof record.ok.target_event_id !== "string" || !isChatKindUuid(record.ok.target_event_id)) {
    return { error: "bad-target-id" };
  }
  if (typeof record.ok.body !== "string" || record.ok.body.trim().length === 0) {
    return { error: "empty-body" };
  }
  const body = record.ok.body.trim();
  const mentions = readMentions(body, record.ok.mentions);
  if ("error" in mentions) return mentions;
  const envelope: ChatEditEnvelope = {
    version: 1,
    kind: CHAT_EDIT_KIND,
    event_id: common.ok.eventId,
    sent_at: common.ok.sentAt,
    target_event_id: record.ok.target_event_id,
    body,
  };
  if (mentions.ok) envelope.mentions = mentions.ok;
  return { ok: envelope };
}

export function parseChatDeleteV0(
  raw: string,
  ctx: ChatKindParseCtx,
): ChatKindParseResult<ChatDeleteEnvelope> {
  const record = asRecord(raw);
  if ("error" in record) return record;
  const common = readCommon(record.ok, CHAT_DELETE_KIND, ctx);
  if ("error" in common) return common;
  if (typeof record.ok.target_event_id !== "string" || !isChatKindUuid(record.ok.target_event_id)) {
    return { error: "bad-target-id" };
  }
  return {
    ok: {
      version: 1,
      kind: CHAT_DELETE_KIND,
      event_id: common.ok.eventId,
      sent_at: common.ok.sentAt,
      target_event_id: record.ok.target_event_id,
    },
  };
}

export function parseChatPinV0(
  raw: string,
  ctx: ChatKindParseCtx,
): ChatKindParseResult<ChatPinEnvelope> {
  const record = asRecord(raw);
  if ("error" in record) return record;
  const common = readCommon(record.ok, CHAT_PIN_KIND, ctx);
  if ("error" in common) return common;
  if (isFutureLwwSentAt(common.ok.sentAt, ctx.now)) return { error: "bad-sent-at" };
  if (record.ok.op !== "set" && record.ok.op !== "clear") return { error: "invalid-op" };
  if (typeof record.ok.target_event_id !== "string" || !isChatKindUuid(record.ok.target_event_id)) {
    return { error: "bad-target-id" };
  }
  if (typeof record.ok.target_author_pubky !== "string" || !isChatKindPubky(record.ok.target_author_pubky)) {
    return { error: "bad-pubky" };
  }
  const envelope: ChatPinEnvelope = {
    version: 1,
    kind: CHAT_PIN_KIND,
    event_id: common.ok.eventId,
    sent_at: common.ok.sentAt,
    target_event_id: record.ok.target_event_id,
    target_author_pubky: record.ok.target_author_pubky,
    op: record.ok.op,
  };
  if (common.ok.channelId) envelope.channel_id = common.ok.channelId;
  return { ok: envelope };
}

export function parseChatGroupInviteV0(
  raw: string,
  ctx: ChatKindParseCtx,
): ChatKindParseResult<ChatGroupInviteEnvelope> {
  const record = asRecord(raw);
  if ("error" in record) return record;
  const common = readCommon(record.ok, GROUP_INVITE_KIND, ctx);
  if ("error" in common) return common;
  if (!common.ok.channelId) return { error: "bad-channel-id" };
  if (typeof record.ok.invite_id !== "string" || !isChatKindUuid(record.ok.invite_id)) {
    return { error: "bad-event-id" };
  }
  if (typeof record.ok.name !== "string") return { error: "invalid-label" };
  const name = nfcTrim(record.ok.name);
  if (name.length === 0 || name.length > 64) return { error: "invalid-label" };
  if (!isLinkSentAtUnixMs(record.ok.expires_at)) return { error: "bad-sent-at" };
  const expiresAt = record.ok.expires_at as number;
  const min = common.ok.sentAt + 60 * 60 * 1000;
  const max = common.ok.sentAt + 7 * 24 * 60 * 60 * 1000;
  if (expiresAt < min || expiresAt > max) return { error: "bad-sent-at" };
  if (expiresAt <= (ctx.now ?? Date.now())) return { error: "expired" };
  return {
    ok: {
      version: 1,
      kind: GROUP_INVITE_KIND,
      event_id: common.ok.eventId,
      sent_at: common.ok.sentAt,
      channel_id: common.ok.channelId,
      invite_id: record.ok.invite_id,
      name,
      expires_at: expiresAt,
    },
  };
}

export function parseUnknownKind(
  raw: string,
  ctx: ChatKindParseCtx,
): ChatKindParseResult<never> {
  void ctx;
  const record = asRecord(raw);
  if ("error" in record) return record;
  if (typeof record.ok.kind !== "string") return { error: "unknown-kind" };
  return { error: "unknown-kind" };
}

export function buildChatTagEnvelope(input: {
  eventId: string;
  sentAt: number;
  targetEventId: string;
  targetAuthorPubky: string;
  label: string;
  op: "add" | "remove";
  channelId?: string;
}): { envelope: ChatTagEnvelope; json: string; byteSize: number } {
  const label = normalizeChatTagLabel(input.label);
  if (!isChatKindUuid(input.eventId) || !isChatKindUuid(input.targetEventId)) {
    throw new Error("chat.tag.v0 ids must be UUIDs");
  }
  if (!isChatKindPubky(input.targetAuthorPubky)) throw new Error("chat.tag.v0 target_author_pubky is invalid");
  if (!isLinkSentAtUnixMs(input.sentAt)) throw new Error("chat.tag.v0 sent_at is invalid");
  if (label === null) throw new Error("chat.tag.v0 label is invalid");
  if (input.channelId && !parseFounderBoundChannelId(input.channelId)) {
    throw new Error("chat.tag.v0 channel_id is invalid");
  }
  const envelope: ChatTagEnvelope = {
    version: 1,
    kind: CHAT_TAG_KIND,
    event_id: input.eventId,
    sent_at: input.sentAt,
    target_event_id: input.targetEventId,
    target_author_pubky: input.targetAuthorPubky,
    label,
    op: input.op,
  };
  if (input.channelId) envelope.channel_id = input.channelId;
  const json = JSON.stringify(envelope);
  const byteSize = utf8Bytes(json);
  if (byteSize > LINK_MESSAGE_MAX_BYTES) {
    throw new Error(`chat.tag.v0 is too long: ${byteSize} bytes serialized`);
  }
  return { envelope, json, byteSize };
}

export function buildChatReceiptEnvelope(input: {
  eventId: string;
  sentAt: number;
  status: "delivered" | "read";
  eventIds: string[];
  channelId?: string;
}): { envelope: ChatReceiptEnvelope; json: string; byteSize: number } {
  const eventIds = [...new Set(input.eventIds)].sort((a, b) => a.localeCompare(b));
  if (!isChatKindUuid(input.eventId)) throw new Error("chat.receipt.v0 event_id must be a UUID");
  if (!isLinkSentAtUnixMs(input.sentAt)) throw new Error("chat.receipt.v0 sent_at is invalid");
  if (eventIds.length < 1 || eventIds.length > CHAT_RECEIPT_EVENT_IDS_CAP) {
    throw new Error("chat.receipt.v0 event_ids cap");
  }
  for (const id of eventIds) {
    if (!isChatKindUuid(id)) throw new Error("chat.receipt.v0 event_ids must be UUIDs");
  }
  if (input.channelId && !parseFounderBoundChannelId(input.channelId)) {
    throw new Error("chat.receipt.v0 channel_id is invalid");
  }
  const envelope: ChatReceiptEnvelope = {
    version: 1,
    kind: CHAT_RECEIPT_KIND,
    event_id: input.eventId,
    sent_at: input.sentAt,
    status: input.status,
    event_ids: eventIds,
  };
  if (input.channelId) envelope.channel_id = input.channelId;
  const json = JSON.stringify(envelope);
  const byteSize = utf8Bytes(json);
  if (byteSize > LINK_MESSAGE_MAX_BYTES) {
    throw new Error(`chat.receipt.v0 is too long: ${byteSize} bytes serialized`);
  }
  return { envelope, json, byteSize };
}

export function dmScopeKey(peerPubky: string): string {
  return `dm:${peerPubky}`;
}

export function aggregateChatTags(
  rows: readonly ChatTagRow[],
  localPubky: string,
): Map<string, ChatTagAggregate[]> {
  const byTarget = new Map<string, Map<string, ChatTagAggregate>>();
  for (const row of rows) {
    const key = `${row.targetAuthorPubky}:${row.targetEventId}`;
    let labels = byTarget.get(key);
    if (!labels) {
      labels = new Map();
      byTarget.set(key, labels);
    }
    const existing = labels.get(row.label) ?? { label: row.label, count: 0, mine: false };
    existing.count += 1;
    if (row.taggerPubky === localPubky) existing.mine = true;
    labels.set(row.label, existing);
  }
  const out = new Map<string, ChatTagAggregate[]>();
  for (const [key, labels] of byTarget) {
    out.set(
      key,
      [...labels.values()].sort((a, b) => a.label.localeCompare(b.label)),
    );
  }
  return out;
}

export function isEmojiTagLabel(label: string): boolean {
  return !CHAT_KIND_WORD_LABEL.test(label);
}

export function deliveryRank(state: string): number {
  if (state === "read") return 3;
  if (state === "delivered") return 2;
  if (state === "sent") return 1;
  return 0;
}

export function monotonicDelivery(current: string, next: "delivered" | "read"): "delivered" | "read" | null {
  const proposed = next === "read" ? "read" : "delivered";
  if (deliveryRank(proposed) <= deliveryRank(current)) return null;
  return proposed;
}
