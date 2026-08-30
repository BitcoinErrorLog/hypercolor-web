import { zeroizeBytes } from "@/lib/hex";
import { signupStagingAndAdopt } from "../link/stagingSignup";
import {
  encryptAndPutAttachment,
  getAndDecryptAttachment,
} from "./AttachmentService";
import { deleteAttachmentCiphertext, getAttachmentCiphertext } from "./homeserver";

/** Non-secret fixture plaintext for the staging attachment proof. */
export const ATTACHMENT_PROOF_PLAINTEXT = "hypercolor-attachment-staging-v1";

export type AttachmentUploadProof = {
  pubky: string;
  location: string;
  attachmentId: string;
  key: string;
  nonce: string;
  size: number;
};

export type AttachmentDownloadProof = {
  bytesEqual: boolean;
  size: number;
  gone: boolean;
};

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Dev/e2e only: signup, encrypt, PUT ciphertext. Never logs the token or key.
 */
export async function runAttachmentSignupUpload(
  signupToken: string,
): Promise<AttachmentUploadProof> {
  const { pubky } = await signupStagingAndAdopt(signupToken);
  const plaintext = new TextEncoder().encode(ATTACHMENT_PROOF_PLAINTEXT);
  const uploaded = await encryptAndPutAttachment(plaintext);
  return {
    pubky,
    location: uploaded.location,
    attachmentId: uploaded.attachmentId,
    key: uploaded.key,
    nonce: uploaded.nonce,
    size: uploaded.size,
  };
}

/**
 * Dev/e2e only: publicGet from any context, decrypt, compare to the fixture.
 * Does not log key material. Zeroizes decrypted bytes after the compare.
 */
export async function runAttachmentPublicDecrypt(input: {
  location: string;
  key: string;
  nonce: string;
}): Promise<AttachmentDownloadProof> {
  const expected = new TextEncoder().encode(ATTACHMENT_PROOF_PLAINTEXT);
  let opened: Uint8Array | undefined;
  try {
    opened = await getAndDecryptAttachment(input.location, input.key, input.nonce);
    return {
      bytesEqual: bytesEqual(opened, expected),
      size: opened.byteLength,
      gone: false,
    };
  } finally {
    if (opened) zeroizeBytes(opened);
    zeroizeBytes(expected);
  }
}

/**
 * Dev/e2e only: DELETE the ciphertext, then publicGet to confirm 404.
 */
export async function runAttachmentDelete(location: string): Promise<{
  deleteOk: boolean;
  gone: boolean;
}> {
  await deleteAttachmentCiphertext(location);
  const after = await getAttachmentCiphertext(location);
  return { deleteOk: true, gone: after === null };
}
