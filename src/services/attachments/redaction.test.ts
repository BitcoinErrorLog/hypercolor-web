/**
 * reconstructAttachmentWireJson is deterministic given unchanged KeyStore
 * state, and fail-closed on eviction or secret rotation (R2-F1).
 */
import "fake-indexeddb/auto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ATTACHMENT_ALGORITHM,
  ATTACHMENT_KEY_PLACEHOLDER,
  attachmentKeyRef,
  buildAttachmentEnvelope,
  buildAttachmentLocation,
  redactAttachmentRawJson,
} from "../../types/attachment";
import { AttachmentError } from "../../types/attachment";
import { KeyStore } from "../KeyStore";
import {
  attachmentSecretFingerprint,
  reconstructAttachmentWireJson,
} from "./redaction";
import { generateAttachmentKey } from "./xchacha";

const OWNER = "a".repeat(52);
const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const ATTACHMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = 1_700_000_000_000;
const LIVE_NONCE = "B".repeat(32);

describe("reconstructAttachmentWireJson", () => {
  beforeAll(async () => {
    await KeyStore.initKeyStore();
  });

  beforeEach(async () => {
    await KeyStore.clear();
    await KeyStore.setPubky(OWNER);
  });

  afterEach(async () => {
    await KeyStore.clear();
  });

  it("rebuilds the same wire JSON twice from unchanged KeyStore state", async () => {
    const key = generateAttachmentKey();
    const built = buildAttachmentEnvelope({
      eventId: EVENT_ID,
      sentAt: NOW,
      location: buildAttachmentLocation(OWNER, ATTACHMENT_ID),
      key,
      nonce: LIVE_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
      contentType: "image/jpeg",
      size: 12,
    });
    await KeyStore.setAttachmentSecret(OWNER, OWNER, EVENT_ID, {
      key,
      nonce: LIVE_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    });
    const redacted = redactAttachmentRawJson(built.json);
    expect(redacted).toContain(ATTACHMENT_KEY_PLACEHOLDER);
    expect(redacted).not.toContain(key);

    const keyRef = attachmentKeyRef(OWNER, OWNER, EVENT_ID);
    const fingerprint = await attachmentSecretFingerprint({
      key,
      nonce: LIVE_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    });
    const first = await reconstructAttachmentWireJson(redacted, keyRef, fingerprint);
    const second = await reconstructAttachmentWireJson(redacted, keyRef, fingerprint);
    expect(first).toBe(second);
    expect(JSON.parse(first)).toEqual(JSON.parse(built.json));
  });

  it("aborts when KeyStore material is evicted", async () => {
    const key = generateAttachmentKey();
    const built = buildAttachmentEnvelope({
      eventId: EVENT_ID,
      sentAt: NOW,
      location: buildAttachmentLocation(OWNER, ATTACHMENT_ID),
      key,
      nonce: LIVE_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
      contentType: "image/jpeg",
      size: 12,
    });
    const redacted = redactAttachmentRawJson(built.json);
    const keyRef = attachmentKeyRef(OWNER, OWNER, EVENT_ID);

    await expect(reconstructAttachmentWireJson(redacted, keyRef)).rejects.toMatchObject({
      name: "AttachmentError",
      code: "not-found",
    });
  });

  it("aborts when KeyStore material no longer matches the persisted fingerprint", async () => {
    const original = generateAttachmentKey();
    const rotated = generateAttachmentKey();
    expect(rotated).not.toBe(original);
    const built = buildAttachmentEnvelope({
      eventId: EVENT_ID,
      sentAt: NOW,
      location: buildAttachmentLocation(OWNER, ATTACHMENT_ID),
      key: original,
      nonce: LIVE_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
      contentType: "image/jpeg",
      size: 12,
    });
    const fingerprint = await attachmentSecretFingerprint({
      key: original,
      nonce: LIVE_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    });
    await KeyStore.setAttachmentSecret(OWNER, OWNER, EVENT_ID, {
      key: rotated,
      nonce: LIVE_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    });
    const redacted = redactAttachmentRawJson(built.json);

    await expect(
      reconstructAttachmentWireJson(redacted, attachmentKeyRef(OWNER, OWNER, EVENT_ID), fingerprint),
    ).rejects.toBeInstanceOf(AttachmentError);
    await expect(
      reconstructAttachmentWireJson(redacted, attachmentKeyRef(OWNER, OWNER, EVENT_ID), fingerprint),
    ).rejects.toMatchObject({
      code: "validation",
      message: expect.stringContaining("changed"),
    });
  });
});
