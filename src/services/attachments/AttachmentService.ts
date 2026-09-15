import { base64urlnopad } from "@scure/base";
import { zeroizeBytes } from "@/lib/hex";
import {
  ATTACHMENT_CIPHERTEXT_MAX_CHARS,
  ATTACHMENT_MAX_BYTES,
} from "@/flags/config";
import {
  ATTACHMENT_ALGORITHM,
  AttachmentError,
  buildAttachmentLocation,
} from "@/types/attachment";
import { attachmentDecrypt, attachmentEncrypt, generateAttachmentKey } from "./xchacha";
import {
  deleteAttachmentCiphertext,
  getAttachmentCiphertext,
  putAttachmentCiphertext,
} from "./homeserver";
import { getLiveSession } from "../link/session";

export type AttachmentUploadResult = {
  location: string;
  attachmentId: string;
  key: string;
  nonce: string;
  algorithm: string;
  size: number;
};

/**
 * Encrypt plaintext and PUT only the ciphertext to the owner homeserver.
 * `plaintext` is treated as consumed and is zeroized on every exit path.
 */
export async function encryptAndPutAttachment(
  plaintext: Uint8Array,
): Promise<AttachmentUploadResult> {
  try {
    const live = getLiveSession();
    if (!live) {
      throw new AttachmentError(
        "unavailable",
        "Enable encrypted messaging to write to your homeserver.",
      );
    }
    if (plaintext.byteLength === 0) {
      throw new AttachmentError("validation", "Attachment plaintext is empty");
    }
    if (plaintext.byteLength > ATTACHMENT_MAX_BYTES) {
      throw new AttachmentError(
        "too-large",
        `Attachment is ${plaintext.byteLength} bytes; v1 limit is ${ATTACHMENT_MAX_BYTES} bytes (8 MiB).`,
      );
    }

    const attachmentId = crypto.randomUUID();
    const location = buildAttachmentLocation(live.pubky, attachmentId);
    const key = generateAttachmentKey();
    const plaintextB64 = base64urlnopad.encode(plaintext);
    const sealed = attachmentEncrypt(plaintextB64, key, location);
    await putAttachmentCiphertext(location, sealed.ciphertextB64);
    return {
      location,
      attachmentId,
      key,
      nonce: sealed.nonceB64,
      algorithm: sealed.algorithm || ATTACHMENT_ALGORITHM,
      size: plaintext.byteLength,
    };
  } finally {
    zeroizeBytes(plaintext);
  }
}

/**
 * Public GET + AAD decrypt. Returned plaintext must be zeroized by the caller
 * after use. Ciphertext never exists as plaintext on the homeserver.
 */
export async function getAndDecryptAttachment(
  location: string,
  key: string,
  nonce: string,
): Promise<Uint8Array> {
  const ciphertextB64 = await getAttachmentCiphertext(location);
  if (!ciphertextB64) {
    throw new AttachmentError(
      "not-found",
      "Attachment ciphertext was not found on the homeserver",
    );
  }
  if (ciphertextB64.length > ATTACHMENT_CIPHERTEXT_MAX_CHARS) {
    throw new AttachmentError(
      "too-large",
      `Attachment ciphertext exceeds the receive-side budget (${ciphertextB64.length} chars)`,
    );
  }
  const plaintextB64 = attachmentDecrypt(ciphertextB64, key, nonce, location);
  return base64urlnopad.decode(plaintextB64);
}

export const AttachmentService = {
  putCiphertext: putAttachmentCiphertext,
  getCiphertext: getAttachmentCiphertext,
  deleteCiphertext: deleteAttachmentCiphertext,
  encryptAndPut: encryptAndPutAttachment,
  getAndDecrypt: getAndDecryptAttachment,
};
