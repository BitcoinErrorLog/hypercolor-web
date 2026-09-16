import { describe, expect, it } from "vitest";
import {
  CHAT_DELETE_KIND,
  CHAT_EDIT_KIND,
  CHAT_PIN_KIND,
  CHAT_RECEIPT_KIND,
  CHAT_TAG_KIND,
  CHAT_TYPING_KIND,
  LINK_MESSAGE_MAX_BYTES,
} from "./link";
import { GROUP_INVITE_KIND } from "./group";
import {
  buildChatReceiptEnvelope,
  buildChatTagEnvelope,
  parseChatDeleteV0,
  parseChatEditV0,
  parseChatGroupInviteV0,
  parseChatPinV0,
  parseChatReceiptV0,
  parseChatTagV0,
  parseChatTypingV0,
  normalizeChatTagLabel,
  serializedUtf8Bytes,
  type ChatKindParseCtx,
} from "./chatKinds";
import { isKnownInboundChatKind, shouldDropOversizedKnownInbound } from "../services/link/inboundEnvelope";

const uuid = "01234567-89ab-cdef-0123-456789abcdef";
const pk = "a".repeat(52);
const ch = `${pk}:${uuid}`;
const ts = 1757000000000;
const CHAT_LWW = 6 * 60 * 1000;
const ctx: ChatKindParseCtx = { senderPubky: pk, ownerPubky: "b".repeat(52), peerTrust: "accepted", now: ts };

describe("chat kinds v1.1 vectors", () => {
  it("shares grapheme-based emoji vectors with mobile", () => {
    const accepted = [
      "😀",
      "❤️",
      "👍🏽",
      "🏴‍☠️",
      "👨‍👩‍👧‍👦",
      "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
      "🇺🇸",
      "🇯🇵",
    ];
    for (const label of accepted) expect(normalizeChatTagLabel(label)).toBe(label);
    expect(normalizeChatTagLabel("\u0001")).toBeNull();
    expect(normalizeChatTagLabel("ok👍")).toBeNull();
    expect(normalizeChatTagLabel("😀".repeat(9))).toBeNull();
  });

  it("accepts valid tag word and emoji", () => {
    const word = buildChatTagEnvelope({
      eventId: uuid,
      sentAt: ts,
      targetEventId: uuid,
      targetAuthorPubky: pk,
      label: "ok",
      op: "add",
    });
    expect(parseChatTagV0(word.json, ctx)).toEqual({ ok: word.envelope });
    const emoji = buildChatTagEnvelope({
      eventId: uuid,
      sentAt: ts,
      targetEventId: uuid,
      targetAuthorPubky: pk,
      label: "👍",
      op: "add",
    });
    expect(parseChatTagV0(emoji.json, ctx)).toEqual({ ok: emoji.envelope });
  });

  it("matches spec byte proofs", () => {
    const tagDm = {
      version: 1,
      kind: CHAT_TAG_KIND,
      event_id: uuid,
      sent_at: ts,
      target_event_id: uuid,
      target_author_pubky: pk,
      label: "👍",
      op: "add",
    };
    expect(serializedUtf8Bytes(tagDm)).toBe(268);
    const tagWorst = {
      ...tagDm,
      label: "w".repeat(32),
      channel_id: ch,
    };
    expect(serializedUtf8Bytes(tagWorst)).toBe(401);
    const rcpt = (n: number, channel?: string) => ({
      version: 1,
      kind: CHAT_RECEIPT_KIND,
      event_id: uuid,
      sent_at: ts,
      status: "delivered",
      event_ids: Array.from({ length: n }, () => uuid),
      ...(channel ? { channel_id: channel } : {}),
    });
    expect(serializedUtf8Bytes(rcpt(12))).toBe(615);
    expect(serializedUtf8Bytes(rcpt(16, ch))).toBe(876);
    expect(serializedUtf8Bytes(rcpt(20))).toBe(927);
    expect(serializedUtf8Bytes(rcpt(16))).toBe(771);
    expect(serializedUtf8Bytes(rcpt(17, ch))).toBe(915);
  });

  it("round-trips encode then decode", () => {
    const tag = buildChatTagEnvelope({
      eventId: uuid,
      sentAt: ts,
      targetEventId: uuid,
      targetAuthorPubky: pk,
      label: "ok",
      op: "add",
      channelId: ch,
    });
    const parsed = parseChatTagV0(tag.json, ctx);
    expect("ok" in parsed && parsed.ok).toEqual(tag.envelope);
    const receipt = buildChatReceiptEnvelope({
      eventId: uuid,
      sentAt: ts,
      status: "read",
      eventIds: [uuid],
    });
    expect(parseChatReceiptV0(receipt.json, ctx)).toEqual({ ok: receipt.envelope });
  });

  it("rejects oversized known kinds", () => {
    const raw = JSON.stringify({
      version: 1,
      kind: CHAT_TAG_KIND,
      event_id: uuid,
      sent_at: ts,
      target_event_id: uuid,
      target_author_pubky: pk,
      label: "ok",
      op: "add",
      pad: "x".repeat(900),
    });
    expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(LINK_MESSAGE_MAX_BYTES);
    expect(isKnownInboundChatKind(CHAT_TAG_KIND)).toBe(true);
    expect(shouldDropOversizedKnownInbound(raw, CHAT_TAG_KIND)).toBe(true);
    expect(parseChatTagV0(raw, ctx)).toEqual({ error: "oversized" });
  });

  it("rejects malformed vectors", () => {
    expect(parseChatTagV0("not-json", ctx)).toEqual({ error: "not-json" });
    expect(
      parseChatTagV0(
        JSON.stringify({
          version: 1,
          kind: CHAT_TAG_KIND,
          event_id: "bad",
          sent_at: ts,
          target_event_id: uuid,
          target_author_pubky: pk,
          label: "ok",
          op: "add",
        }),
        ctx,
      ),
    ).toEqual({ error: "bad-event-id" });
    expect(
      parseChatTagV0(
        JSON.stringify({
          version: 1,
          kind: CHAT_TAG_KIND,
          event_id: uuid,
          sent_at: ts,
          target_event_id: uuid,
          target_author_pubky: pk,
          label: "OK",
          op: "add",
        }),
        ctx,
      ),
    ).toEqual({ error: "invalid-label" });
    expect(
      parseChatReceiptV0(
        JSON.stringify({
          version: 1,
          kind: CHAT_RECEIPT_KIND,
          event_id: uuid,
          sent_at: ts,
          status: "seen",
          event_ids: [uuid],
        }),
        ctx,
      ),
    ).toEqual({ error: "invalid-status" });
    const seventeen = Array.from({ length: 17 }, () => uuid);
    expect(
      parseChatReceiptV0(
        JSON.stringify({
          version: 1,
          kind: CHAT_RECEIPT_KIND,
          event_id: uuid,
          sent_at: ts,
          status: "delivered",
          event_ids: seventeen.sort(),
        }),
        ctx,
      ),
    ).toEqual({ error: "event-ids-cap" });
    expect(
      parseChatTypingV0(
        JSON.stringify({
          version: 1,
          kind: CHAT_TYPING_KIND,
          event_id: uuid,
          sent_at: ts,
          state: "idle",
        }),
        ctx,
      ),
    ).toEqual({ error: "invalid-state" });
    const parsed = parseChatEditV0(JSON.stringify({
      version: 1, kind: CHAT_EDIT_KIND, event_id: uuid, sent_at: ts, target_event_id: uuid, body: "hi",
    }), ctx);
    expect("ok" in parsed).toBe(true);
    expect(
      parseChatPinV0(
        JSON.stringify({
          version: 1,
          kind: CHAT_PIN_KIND,
          event_id: uuid,
          sent_at: ts + CHAT_LWW,
          target_event_id: uuid,
          target_author_pubky: pk,
          op: "set",
        }),
        { ...ctx, now: ts },
      ),
    ).toEqual({ error: "bad-sent-at" });
  });

  it("self-attack: spoofed author field is ignored; tagger is ctx sender", () => {
    const json = JSON.stringify({
      version: 1,
      kind: CHAT_TAG_KIND,
      event_id: uuid,
      sent_at: ts,
      target_event_id: uuid,
      target_author_pubky: pk,
      label: "ok",
      op: "add",
      tagger: "z".repeat(52),
      author: "z".repeat(52),
    });
    const parsed = parseChatTagV0(json, ctx);
    expect("ok" in parsed).toBe(true);
    if ("ok" in parsed) {
      expect(parsed.ok).not.toHaveProperty("author");
    }
  });

  it("self-attack: oversized word label and mixed word+emoji", () => {
    expect(parseChatTagV0(JSON.stringify({
      version: 1, kind: CHAT_TAG_KIND, event_id: uuid, sent_at: ts,
      target_event_id: uuid, target_author_pubky: pk, label: "w".repeat(33), op: "add",
    }), ctx)).toEqual({ error: "invalid-label" });
    expect(parseChatTagV0(JSON.stringify({
      version: 1, kind: CHAT_TAG_KIND, event_id: uuid, sent_at: ts,
      target_event_id: uuid, target_author_pubky: pk, label: "ok👍", op: "add",
    }), ctx)).toEqual({ error: "invalid-label" });
  });

  it("rejects control, bidi, zero-width, and invisible tag labels", () => {
    const wrap = (label: string) =>
      JSON.stringify({
        version: 1,
        kind: CHAT_TAG_KIND,
        event_id: uuid,
        sent_at: ts,
        target_event_id: uuid,
        target_author_pubky: pk,
        label,
        op: "add",
      });
    expect(parseChatTagV0(wrap("\u200E"), ctx)).toEqual({ error: "invalid-label" });
    expect(parseChatTagV0(wrap("\u202E"), ctx)).toEqual({ error: "invalid-label" });
    expect(parseChatTagV0(wrap("\u200B"), ctx)).toEqual({ error: "invalid-label" });
    expect(parseChatTagV0(wrap("\u200D"), ctx)).toEqual({ error: "invalid-label" });
    expect(parseChatTagV0(wrap("\uFE0F"), ctx)).toEqual({ error: "invalid-label" });
    expect("ok" in parseChatTagV0(wrap("👍"), ctx)).toBe(true);
  });

  it("self-attack: receipt as presence still requires the peer link (gated)", () => {
    const json = JSON.stringify({
      version: 1,
      kind: CHAT_RECEIPT_KIND,
      event_id: uuid,
      sent_at: ts,
      status: "read",
      event_ids: [uuid],
    });
    expect(parseChatReceiptV0(json, { ...ctx, peerTrust: "gated" })).toEqual({ error: "gated-peer" });
  });

  it("parses remaining kind vectors", () => {
    const del = parseChatDeleteV0(JSON.stringify({
      version: 1, kind: CHAT_DELETE_KIND, event_id: uuid, sent_at: ts, target_event_id: uuid,
    }), ctx);
    expect("ok" in del && del.ok.kind === CHAT_DELETE_KIND).toBe(true);
    const typing = parseChatTypingV0(JSON.stringify({
      version: 1, kind: CHAT_TYPING_KIND, event_id: uuid, sent_at: ts, state: "start",
    }), ctx);
    expect("ok" in typing && typing.ok.state === "start").toBe(true);
    const invite = parseChatGroupInviteV0(JSON.stringify({
      version: 1, kind: GROUP_INVITE_KIND, event_id: uuid, sent_at: ts, channel_id: ch,
      invite_id: uuid, name: "n", expires_at: ts + 3_600_000,
    }), ctx);
    expect("ok" in invite && invite.ok.kind === GROUP_INVITE_KIND).toBe(true);
    expect(isKnownInboundChatKind("chat.foo.v0")).toBe(false);
  });
});
