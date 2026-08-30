import { KeyStore } from "../KeyStore";
import { StorageService } from "../StorageService";
import {
  backupLatestUrl,
  decryptOwnerBackup,
  encryptOwnerBackup,
} from "./crypto";

export type { OwnerBackupSnapshot } from "./snapshot";
export { OWNER_BACKUP_VERSION } from "./snapshot";
export {
  BACKUP_AEAD_ALGORITHM,
  BACKUP_NONCE_BYTES,
  RECOVERY_CODE_BYTES,
  backupLatestUrl,
  decodeRecoveryCode,
  decryptOwnerBackup,
  encodeKey,
  encryptOwnerBackup,
  generateRecoveryCode,
  openBackupCiphertext,
  parseBackupBlob,
  parseSnapshot,
  sealOwnerBackup,
  stringifyBackupBlob,
  xchachaOpen,
  xchachaSeal,
} from "./crypto";
export type { EncryptedOwnerBackup, OwnerBackupBlob } from "./crypto";

/**
 * Homeserver upload/download hook. P3 `PaykitLinkWeb` (or any authenticated
 * owner PUT / public GET) must call `configureBackupTransport`:
 *
 * - `putOwner(url, content)` — authenticated PUT of the backup blob to
 *   `backupLatestUrl(owner)`
 * - `getPublic(url)` — GET of that blob (404 → `null`)
 *
 * Crypto does not wait on that hook. `encryptOwnerBackup` /
 * `decryptOwnerBackup` are the product functions this service calls. Until
 * the hook is configured, `exportBackup` / `restoreBackup` throw so a
 * homeserver write is never implied.
 */
export type BackupTransport = {
  putOwner: (url: string, content: string) => Promise<void>;
  getPublic: (url: string) => Promise<string | null>;
};

let transport: BackupTransport | null = null;

export function configureBackupTransport(next: BackupTransport | null): void {
  transport = next;
}

export function getBackupTransport(): BackupTransport | null {
  return transport;
}

/**
 * Multi-device backup uses a random 32-byte recovery code
 * (`crypto.getRandomValues(32)` → base64url, no padding), not a passphrase.
 * That is the same encoding as mobile `generateAttachmentKey`.
 *
 * Ciphertext is XChaCha20-Poly1305 (`@noble/ciphers`) with AAD bound to
 * `pubky://{owner}/pub/hypercolor.app/v1/backup/latest`.
 *
 * Device-bound secrets are never included: receiver Noise alias, session
 * alias, link snapshots, attachment content keys. After restore, history
 * is local again; live links re-handshake; attachments without keys show
 * as unavailable-from-backup until re-shared.
 */
export const BackupService = {
  /**
   * Collect owner-scoped data, encrypt under a fresh recovery code, upload
   * ciphertext via the configured `putOwner` hook. Returns the recovery
   * code once.
   */
  async exportBackup(): Promise<{ recoveryCode: string; path: string }> {
    const hook = requireTransport();
    const owner = await requireOwner();
    const snapshot = await StorageService.collectOwnerBackup(owner);
    const { recoveryCode, blob, path } = encryptOwnerBackup(snapshot, owner);
    await hook.putOwner(path, blob);
    return { recoveryCode, path };
  },

  /**
   * Download via `getPublic`, AAD-decrypt, validate version/owner, import
   * with upsert / insert-or-ignore semantics.
   */
  async restoreBackup(recoveryCode: string): Promise<void> {
    const hook = requireTransport();
    const owner = await requireOwner();
    const code = recoveryCode.trim();
    if (code.length === 0) {
      throw new Error("Recovery code is required");
    }
    const path = backupLatestUrl(owner);
    const raw = await hook.getPublic(path);
    if (!raw) {
      throw new Error("No backup found on this account");
    }
    const snapshot = decryptOwnerBackup(raw, code, owner);
    await StorageService.importOwnerBackup(owner, snapshot);
  },
};

async function requireOwner(): Promise<string> {
  const owner = await KeyStore.getPubky();
  if (!owner) throw new Error("BackupService: no active account");
  return owner;
}

function requireTransport(): BackupTransport {
  if (!transport) {
    throw new Error(
      "BackupService: homeserver transport is not configured. Call configureBackupTransport({ putOwner, getPublic }) after P3 PaykitLinkWeb owner writes are wired. Use encryptOwnerBackup / decryptOwnerBackup until then.",
    );
  }
  return transport;
}
