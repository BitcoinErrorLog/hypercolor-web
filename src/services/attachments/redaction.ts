// Copied from BitcoinErrorLog/hypercolor services/attachments/redaction.ts
// pin c7157aaa1b338dd1d8545e82f639007cba945631
import { KeyStore, type AttachmentSecretMaterial } from '../KeyStore';
import { bytesToHex } from '@/lib/hex';
import {
  AttachmentError,
  ATTACHMENT_KEY_PLACEHOLDER,
  decodePersistedAttachmentEnvelope,
  parseAttachmentKeyRef,
  type ChatAttachmentEnvelope,
} from '../../types/attachment';

/**
 * Canonical SHA-256 of attachment key material. Retry stores this at persist
 * time and refuses to rebuild wire JSON if KeyStore no longer matches — a
 * rotated or replaced secret at the same Noise nonce is keystream reuse.
 */
export async function attachmentSecretFingerprint(
  secret: AttachmentSecretMaterial,
): Promise<string> {
  const canonical = [
    secret.key,
    secret.nonce,
    secret.algorithm ?? '',
    secret.thumbnail?.key ?? '',
    secret.thumbnail?.nonce ?? '',
  ].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return bytesToHex(new Uint8Array(digest));
}

export async function fingerprintStoredAttachmentSecret(
  ownerPubky: string,
  senderPubky: string,
  eventId: string,
): Promise<string> {
  const secret = await KeyStore.getAttachmentSecret(ownerPubky, senderPubky, eventId);
  if (!secret) {
    throw new AttachmentError('not-found', 'Attachment key material is not in KeyStore');
  }
  return attachmentSecretFingerprint(secret);
}

/**
 * Rebuilds the real `chat.attachment.v0` wire JSON from a persisted
 * redacted copy plus KeyStore material. Retry/send paths must call this
 * immediately before native send — they must never persist the result.
 *
 * Deterministic given unchanged KeyStore state: same redacted envelope +
 * same secret yields the same JSON.stringify output. Eviction throws
 * `not-found`. If `expectedFingerprint` is supplied (retry payloads persist
 * it), a rotated/replaced secret throws `validation` and the caller must
 * fail the retry closed — never encrypt different plaintext at the same
 * Noise nonce.
 *
 * Web KeyStore is async; wrap/unwrap requires `setPubky` first.
 */
export async function reconstructAttachmentWireJson(
  redactedRawJson: string,
  keyRef: string,
  expectedFingerprint?: string,
): Promise<string> {
  const parsed = parseAttachmentKeyRef(keyRef);
  if (!parsed) {
    throw new AttachmentError('not-found', 'Invalid attachment keyRef');
  }
  const envelope = decodePersistedAttachmentEnvelope(redactedRawJson);
  if (!envelope) {
    throw new AttachmentError('validation', 'Cannot reconstruct attachment wire JSON');
  }
  const secret = await KeyStore.getAttachmentSecret(
    parsed.ownerPubky,
    parsed.senderPubky,
    parsed.eventId,
  );
  if (!secret) {
    throw new AttachmentError('not-found', 'Attachment key material is not in KeyStore');
  }
  if (expectedFingerprint !== undefined) {
    const live = await attachmentSecretFingerprint(secret);
    if (live !== expectedFingerprint) {
      throw new AttachmentError(
        'validation',
        'Attachment key material changed; refusing to re-encrypt at the same nonce',
      );
    }
  }
  const live: ChatAttachmentEnvelope = {
    ...envelope,
    key: secret.key,
    nonce: secret.nonce,
    algorithm: secret.algorithm || envelope.algorithm,
  };
  if (envelope.thumbnail) {
    if (!secret.thumbnail) {
      throw new AttachmentError('not-found', 'Thumbnail key material is not in KeyStore');
    }
    live.thumbnail = {
      ...envelope.thumbnail,
      key: secret.thumbnail.key,
      nonce: secret.thumbnail.nonce,
    };
  }
  return JSON.stringify(live);
}

export function attachmentRawJsonHasLiveSecrets(
  rawJson: string,
  secrets: readonly string[],
): boolean {
  return secrets.some(
    value => value.length > 0 && value !== ATTACHMENT_KEY_PLACEHOLDER && rawJson.includes(value),
  );
}
