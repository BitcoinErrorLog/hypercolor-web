/**
 * XChaCha20-Poly1305 attachment AEAD, matching mobile Paykit FFI wire:
 * - key: 32 random bytes, unpadded base64url
 * - nonce: 24 random bytes, unpadded base64url (travels in the access PAM)
 * - ciphertext: sealed bytes (ciphertext || 16-byte tag), unpadded base64url
 * - plaintext: raw file bytes encoded as unpadded base64url
 * - AAD: UTF-8 of the attachment `location` string exactly as
 *   {@link buildAttachmentLocation}:
 *   `pubky://{owner}/pub/hypercolor.app/v1/attachments/{uuid}`
 *
 * The nonce is not prepended to the homeserver blob.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { base64urlnopad } from "@scure/base";
import {
  ATTACHMENT_ALGORITHM,
  AttachmentError,
  isCanonicalAttachmentKey,
  isCanonicalAttachmentNonce,
} from "../../types/attachment";

const KEY_BYTES = 32;
const NONCE_BYTES = 24;

export interface AttachmentCiphertext {
  nonceB64: string;
  ciphertextB64: string;
  algorithm: string;
}

function requireCrypto(): Crypto {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.getRandomValues !== "function") {
    throw new AttachmentError(
      "unavailable",
      "crypto.getRandomValues is unavailable",
    );
  }
  return crypto;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  requireCrypto().getRandomValues(bytes);
  return bytes;
}

function decodeB64Url(value: string, label: string): Uint8Array {
  try {
    return base64urlnopad.decode(value);
  } catch {
    throw new AttachmentError("validation", `Invalid ${label} encoding`);
  }
}

function encodeB64Url(bytes: Uint8Array): string {
  return base64urlnopad.encode(bytes);
}

function aadBytes(location: string): Uint8Array {
  return new TextEncoder().encode(location);
}

/**
 * Fresh 32-byte attachment content key as unpadded base64url (43 chars).
 * Same encoding mobile `generateAttachmentKey` returns on the wire.
 */
export function generateAttachmentKey(): string {
  return encodeB64Url(randomBytes(KEY_BYTES));
}

/**
 * Encrypt `plaintextB64` (unpadded base64url of the raw bytes) under `keyB64`.
 * AAD MUST be the canonical attachment `location` string.
 */
export function attachmentEncrypt(
  plaintextB64: string,
  keyB64: string,
  aad: string,
): AttachmentCiphertext {
  if (!isCanonicalAttachmentKey(keyB64)) {
    throw new AttachmentError(
      "validation",
      "Attachment key must be 32-byte unpadded base64url",
    );
  }
  const key = decodeB64Url(keyB64, "attachment key");
  if (key.byteLength !== KEY_BYTES) {
    throw new AttachmentError("validation", "Attachment key must be 32 bytes");
  }
  const plaintext = decodeB64Url(plaintextB64, "attachment plaintext");
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = xchacha20poly1305(key, nonce, aadBytes(aad)).encrypt(plaintext);
  return {
    nonceB64: encodeB64Url(nonce),
    ciphertextB64: encodeB64Url(sealed),
    algorithm: ATTACHMENT_ALGORITHM,
  };
}

/**
 * Decrypt `ciphertextB64` (unpadded base64url of ciphertext || tag).
 * AAD MUST equal the `location` used at encrypt time.
 */
export function attachmentDecrypt(
  ciphertextB64: string,
  keyB64: string,
  nonceB64: string,
  aad: string,
): string {
  if (!isCanonicalAttachmentKey(keyB64)) {
    throw new AttachmentError(
      "validation",
      "Attachment key must be 32-byte unpadded base64url",
    );
  }
  if (!isCanonicalAttachmentNonce(nonceB64)) {
    throw new AttachmentError(
      "validation",
      "Attachment nonce must be 24-byte unpadded base64url",
    );
  }
  const key = decodeB64Url(keyB64, "attachment key");
  const nonce = decodeB64Url(nonceB64, "attachment nonce");
  if (key.byteLength !== KEY_BYTES) {
    throw new AttachmentError("validation", "Attachment key must be 32 bytes");
  }
  if (nonce.byteLength !== NONCE_BYTES) {
    throw new AttachmentError("validation", "Attachment nonce must be 24 bytes");
  }
  const sealed = decodeB64Url(ciphertextB64, "attachment ciphertext");
  try {
    const plaintext = xchacha20poly1305(key, nonce, aadBytes(aad)).decrypt(
      sealed,
    );
    return encodeB64Url(plaintext);
  } catch {
    throw new AttachmentError(
      "decrypt-failed",
      "Attachment ciphertext failed authentication",
    );
  }
}
