import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { base64urlnopad } from "@scure/base";
import { OWNER_BACKUP_VERSION, type OwnerBackupSnapshot } from "./snapshot";

/** Algorithm label written into the backup blob. Same string as mobile native. */
export const BACKUP_AEAD_ALGORITHM = "XChaCha20Poly1305" as const;

/** Random 32-byte recovery key — same size as `generateAttachmentKey`. */
export const RECOVERY_CODE_BYTES = 32;

/** Fresh 24-byte XChaCha20-Poly1305 nonce — same size as native `nonceB64`. */
export const BACKUP_NONCE_BYTES = 24;

const BACKUP_PATH_SUFFIX = "/pub/hypercolor.app/v1/backup/latest";
const DECRYPT_FAILED = "Backup decrypt failed";

export type OwnerBackupBlob = {
  version: 1;
  algorithm: typeof BACKUP_AEAD_ALGORITHM;
  nonceB64: string;
  ciphertextB64: string;
};

export type EncryptedOwnerBackup = {
  recoveryCode: string;
  blob: string;
  path: string;
};

/**
 * Homeserver path and AEAD AAD. Identical to mobile
 * `backupLatestUrl` in `src/services/backup/BackupService.ts`:
 * `pubky://{owner}/pub/hypercolor.app/v1/backup/latest`.
 */
export function backupLatestUrl(ownerPubky: string): string {
  return `pubky://${ownerPubky}${BACKUP_PATH_SUFFIX}`;
}

/**
 * Random 32-byte recovery code, base64url with no padding.
 *
 * Byte-for-byte the same encoding as mobile
 * `PaykitLinkNative.generateAttachmentKey` (`src/services/link/PaykitLinkNative.ts`:
 * "Random 32-byte attachment key, base64url (no padding).") and UniFFI
 * `generateAttachmentKey` (`paykit.swift`: "Generate a random 32-byte
 * attachment key, encoded as base64url (no padding).").
 *
 * 32 zero bytes encode as `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
 * (43 chars), the recovery-code fixture used in mobile
 * `src/services/backup/__tests__/BackupService.test.ts`.
 */
export function generateRecoveryCode(): string {
  const key = new Uint8Array(RECOVERY_CODE_BYTES);
  crypto.getRandomValues(key);
  return encodeKey(key);
}

/**
 * Encrypt an owner snapshot under a fresh recovery code.
 * AEAD plaintext is the UTF-8 JSON (native `attachmentEncrypt` decodes the
 * intermediate base64url wrap back to these same bytes). AAD is
 * `backupLatestUrl(owner)`.
 */
export function encryptOwnerBackup(
  snapshot: OwnerBackupSnapshot,
  owner: string,
): EncryptedOwnerBackup {
  if (snapshot.ownerPubky !== owner) {
    throw new Error("Backup belongs to a different account");
  }
  if (snapshot.version !== OWNER_BACKUP_VERSION) {
    throw new Error(
      `Unsupported backup snapshot version: ${String(snapshot.version)}`,
    );
  }
  const path = backupLatestUrl(owner);
  const recoveryCode = generateRecoveryCode();
  const nonce = new Uint8Array(BACKUP_NONCE_BYTES);
  crypto.getRandomValues(nonce);
  const blob = sealOwnerBackup(
    snapshot,
    decodeRecoveryCode(recoveryCode),
    nonce,
    path,
  );
  return { recoveryCode, blob: stringifyBackupBlob(blob), path };
}

/**
 * Decrypt a backup blob with the recovery code, bound to `owner`'s AAD.
 * Fails closed on wrong key, wrong AAD, truncated/forged ciphertext, or a
 * snapshot whose `ownerPubky` does not match `owner`.
 */
export function decryptOwnerBackup(
  rawBlob: string,
  recoveryCode: string,
  owner: string,
): OwnerBackupSnapshot {
  const code = recoveryCode.trim();
  if (code.length === 0) {
    throw new Error("Recovery code is required");
  }
  const path = backupLatestUrl(owner);
  const blob = parseBackupBlob(rawBlob);
  const plaintext = openBackupCiphertext(
    blob,
    decodeRecoveryCode(code),
    path,
  );
  const snapshot = parseSnapshot(new TextDecoder().decode(plaintext));
  if (snapshot.ownerPubky !== owner) {
    throw new Error("Backup belongs to a different account");
  }
  return snapshot;
}

/** Real XChaCha20-Poly1305 seal. Exported so tests and the vector script share params. */
export function xchachaSeal(
  plaintext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  assertKeyNonce(key, nonce);
  return xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
}

/** Real XChaCha20-Poly1305 open. Auth failure is a fixed redacted error. */
export function xchachaOpen(
  sealed: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  assertKeyNonce(key, nonce);
  try {
    return xchacha20poly1305(key, nonce, aad).decrypt(sealed);
  } catch {
    throw new Error(DECRYPT_FAILED);
  }
}

export function encodeKey(bytes: Uint8Array): string {
  return base64urlnopad.encode(bytes);
}

export function decodeRecoveryCode(code: string): Uint8Array {
  let key: Uint8Array;
  try {
    key = base64urlnopad.decode(code.trim());
  } catch {
    throw new Error("Recovery code is invalid");
  }
  if (key.length !== RECOVERY_CODE_BYTES) {
    throw new Error("Recovery code is invalid");
  }
  return key;
}

export function parseBackupBlob(raw: string): OwnerBackupBlob {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Backup blob is not valid JSON");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Backup blob is malformed");
  }
  const rec = value as Record<string, unknown>;
  if (rec.version !== 1) {
    throw new Error(`Unsupported backup blob version: ${String(rec.version)}`);
  }
  if (typeof rec.ciphertextB64 !== "string" || typeof rec.nonceB64 !== "string") {
    throw new Error("Backup blob is missing ciphertext");
  }
  return {
    version: 1,
    algorithm: BACKUP_AEAD_ALGORITHM,
    nonceB64: rec.nonceB64,
    ciphertextB64: rec.ciphertextB64,
  };
}

export function stringifyBackupBlob(blob: OwnerBackupBlob): string {
  return JSON.stringify({
    version: blob.version,
    algorithm: blob.algorithm,
    nonceB64: blob.nonceB64,
    ciphertextB64: blob.ciphertextB64,
  });
}

export function sealOwnerBackup(
  snapshot: OwnerBackupSnapshot,
  key: Uint8Array,
  nonce: Uint8Array,
  aadUtf8: string,
): OwnerBackupBlob {
  const plaintext = new TextEncoder().encode(JSON.stringify(snapshot));
  const sealed = xchachaSeal(
    plaintext,
    key,
    nonce,
    new TextEncoder().encode(aadUtf8),
  );
  return {
    version: 1,
    algorithm: BACKUP_AEAD_ALGORITHM,
    nonceB64: encodeKey(nonce),
    ciphertextB64: encodeKey(sealed),
  };
}

export function openBackupCiphertext(
  blob: OwnerBackupBlob,
  key: Uint8Array,
  aadUtf8: string,
): Uint8Array {
  let nonce: Uint8Array;
  let sealed: Uint8Array;
  try {
    nonce = base64urlnopad.decode(blob.nonceB64);
    sealed = base64urlnopad.decode(blob.ciphertextB64);
  } catch {
    throw new Error(DECRYPT_FAILED);
  }
  if (nonce.length !== BACKUP_NONCE_BYTES) {
    throw new Error(DECRYPT_FAILED);
  }
  return xchachaOpen(sealed, key, nonce, new TextEncoder().encode(aadUtf8));
}

export function parseSnapshot(json: string): OwnerBackupSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Backup snapshot is not valid JSON");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Backup snapshot is malformed");
  }
  const rec = value as OwnerBackupSnapshot;
  if (rec.version !== OWNER_BACKUP_VERSION) {
    throw new Error(
      `Unsupported backup snapshot version: ${String(rec.version)}`,
    );
  }
  if (typeof rec.ownerPubky !== "string" || rec.ownerPubky.length === 0) {
    throw new Error("Backup snapshot is missing owner");
  }
  if (!Array.isArray(rec.contacts) || !Array.isArray(rec.linkMessages)) {
    throw new Error("Backup snapshot is missing required collections");
  }
  return rec;
}

function assertKeyNonce(key: Uint8Array, nonce: Uint8Array): void {
  if (key.length !== RECOVERY_CODE_BYTES) {
    throw new Error("Recovery code is invalid");
  }
  if (nonce.length !== BACKUP_NONCE_BYTES) {
    throw new Error("Backup nonce is invalid");
  }
}
