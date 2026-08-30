import { base64urlnopad } from "@scure/base";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_ALGORITHM,
  ATTACHMENT_KEY_B64URL_LENGTH,
  ATTACHMENT_NONCE_B64URL_LENGTH,
  AttachmentError,
  buildAttachmentLocation,
  isCanonicalAttachmentKey,
  isCanonicalAttachmentNonce,
} from "../../types/attachment";
import kat from "./__fixtures__/xchacha-kat.json";
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

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hex length must be even");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.byteLength; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe("attachment xchacha (mobile wire)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("matches the paykit-lib XChaCha20-Poly1305 known-answer vector", () => {
    expect(kat.algorithm).toBe(ATTACHMENT_ALGORITHM);
    expect(kat.aad).toBe(buildAttachmentLocation(kat.owner, kat.attachmentId));
    expect(kat.aad).toBe(location());
    expect(isCanonicalAttachmentKey(kat.keyB64)).toBe(true);
    expect(isCanonicalAttachmentNonce(kat.nonceB64)).toBe(true);
    expect(base64urlnopad.encode(hexToBytes(kat.keyHex))).toBe(kat.keyB64);
    expect(base64urlnopad.encode(hexToBytes(kat.nonceHex))).toBe(kat.nonceB64);
    expect(base64urlnopad.encode(hexToBytes(kat.plaintextHex))).toBe(
      kat.plaintextB64,
    );
    expect(base64urlnopad.encode(hexToBytes(kat.ciphertextHex))).toBe(
      kat.ciphertextB64,
    );
    expect(hexToBytes(kat.ciphertextHex).byteLength).toBe(
      hexToBytes(kat.plaintextHex).byteLength + 16,
    );

    const opened = attachmentDecrypt(
      kat.ciphertextB64,
      kat.keyB64,
      kat.nonceB64,
      kat.aad,
    );
    expect(opened).toBe(kat.plaintextB64);

    const nonce = hexToBytes(kat.nonceHex);
    const originalGetRandomValues = globalThis.crypto.getRandomValues.bind(
      globalThis.crypto,
    );
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(
      ((array: ArrayBufferView) => {
        if (array.byteLength === 24) {
          new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(
            nonce,
          );
          return array;
        }
        return originalGetRandomValues(array);
      }) as typeof crypto.getRandomValues,
    );

    const sealed = attachmentEncrypt(kat.plaintextB64, kat.keyB64, kat.aad);
    expect(sealed.algorithm).toBe(ATTACHMENT_ALGORITHM);
    expect(sealed.nonceB64).toBe(kat.nonceB64);
    expect(sealed.ciphertextB64).toBe(kat.ciphertextB64);
  });
});
