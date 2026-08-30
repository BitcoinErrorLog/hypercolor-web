import { base64urlnopad } from "@scure/base";
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_ALGORITHM,
  ATTACHMENT_KEY_B64URL_LENGTH,
  ATTACHMENT_NONCE_B64URL_LENGTH,
  AttachmentError,
  buildAttachmentLocation,
  isCanonicalAttachmentKey,
  isCanonicalAttachmentNonce,
} from "../../types/attachment";
import {
  attachmentDecrypt,
  attachmentEncrypt,
  generateAttachmentKey,
} from "./xchacha";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const ATTACHMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_ID = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function location(): string {
  return buildAttachmentLocation(OWNER, ATTACHMENT_ID);
}

describe("attachment xchacha (mobile wire)", () => {
  it("generateAttachmentKey returns 32 CSPRNG bytes as unpadded base64url", () => {
    const key = generateAttachmentKey();
    expect(isCanonicalAttachmentKey(key)).toBe(true);
    expect(key).toHaveLength(ATTACHMENT_KEY_B64URL_LENGTH);
    expect(base64urlnopad.decode(key).byteLength).toBe(32);
    expect(generateAttachmentKey()).not.toBe(key);
  });

  it("round-trips plaintext with AAD bound to buildAttachmentLocation", () => {
    const aad = location();
    expect(aad).toBe(
      `pubky://${OWNER}/pub/hypercolor.app/v1/attachments/${ATTACHMENT_ID}`,
    );
    const key = generateAttachmentKey();
    const plaintext = new TextEncoder().encode("hypercolor-attachment");
    const plaintextB64 = base64urlnopad.encode(plaintext);
    const sealed = attachmentEncrypt(plaintextB64, key, aad);

    expect(sealed.algorithm).toBe(ATTACHMENT_ALGORITHM);
    expect(isCanonicalAttachmentNonce(sealed.nonceB64)).toBe(true);
    expect(sealed.nonceB64).toHaveLength(ATTACHMENT_NONCE_B64URL_LENGTH);
    expect(base64urlnopad.decode(sealed.nonceB64).byteLength).toBe(24);
    const sealedBytes = base64urlnopad.decode(sealed.ciphertextB64);
    expect(sealedBytes.byteLength).toBe(plaintext.byteLength + 16);

    const opened = attachmentDecrypt(
      sealed.ciphertextB64,
      key,
      sealed.nonceB64,
      aad,
    );
    expect(opened).toBe(plaintextB64);
    expect(new TextDecoder().decode(base64urlnopad.decode(opened))).toBe(
      "hypercolor-attachment",
    );
  });

  it("fails closed when AAD is not the exact location string", () => {
    const key = generateAttachmentKey();
    const plaintextB64 = base64urlnopad.encode(
      new TextEncoder().encode("secret-bytes"),
    );
    const sealed = attachmentEncrypt(plaintextB64, key, location());
    const wrong = buildAttachmentLocation(OWNER, OTHER_ID);
    const thumb = `${location()}.thumb`;

    expect(() =>
      attachmentDecrypt(sealed.ciphertextB64, key, sealed.nonceB64, wrong),
    ).toThrow(AttachmentError);
    try {
      attachmentDecrypt(sealed.ciphertextB64, key, sealed.nonceB64, thumb);
      expect.unreachable("thumb suffix must not authenticate");
    } catch (err) {
      expect(err).toBeInstanceOf(AttachmentError);
      expect((err as AttachmentError).code).toBe("decrypt-failed");
    }
  });
});
