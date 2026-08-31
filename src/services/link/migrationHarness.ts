import { zeroizeBytes } from "@/lib/hex";
import { KeyStore } from "@/services/KeyStore";
import { StorageService } from "@/services/StorageService";
import {
  encryptAndPutAttachment,
  getAndDecryptAttachment,
} from "@/services/attachments/AttachmentService";
import { getAttachmentCiphertext } from "@/services/attachments/homeserver";
import {
  LINK_RECEIVER_PATH,
  buildDmConversationId,
} from "@/types/link";
import { LinkService } from "./LinkService";
import { PaykitLinkWeb } from "./PaykitLinkWeb";
import { STAGING_HOMESERVER_Z32 } from "./ownerRoundtrip";
import { redactSignupToken } from "./stagingSignup";
import { getLiveSession } from "./session";

export type MigrationSignupResult = {
  pubky: string;
  receiverPath: string;
};

export type MigrationIdentity = {
  pubky: string;
  receiverPath: string;
};

export type AttachmentPresence = {
  location: string;
  found: boolean;
  bytesEqual: boolean;
};

export const MIGRATION_PUBLIC_DOC_PATH =
  "/pub/hypercolor.app/v1/public-channels/migration-proof.json";

export const MIGRATION_ATTACHMENT_PLAINTEXT = "hypercolor-migration-attachment-v1";

let identitySecret: Uint8Array | null = null;
let attachmentMaterial: { location: string; key: string; nonce: string } | null =
  null;

function randomIdentitySecret(): Uint8Array {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  return secret;
}

function requireIdentitySecret(): Uint8Array {
  if (!identitySecret) {
    throw new Error("runMigrationSignup must run before migrate");
  }
  return identitySecret;
}

/**
 * Dev/e2e only: signup on staging, keep the identity secret in page memory
 * (never logged) so the same pubky can later signup on another homeserver.
 */
export async function runMigrationSignup(
  signupToken: string,
): Promise<MigrationSignupResult> {
  const token = signupToken.trim();
  if (!token) throw new Error("runMigrationSignup: signup token is required");
  await KeyStore.initKeyStore();
  if (identitySecret) {
    zeroizeBytes(identitySecret);
    identitySecret = null;
  }
  const secret = randomIdentitySecret();
  let session;
  try {
    try {
      session = await PaykitLinkWeb.signupWithSecret(
        secret,
        STAGING_HOMESERVER_Z32,
        token,
      );
    } catch (error) {
      throw redactSignupToken(error, token);
    }
    identitySecret = new Uint8Array(secret);
  } finally {
    zeroizeBytes(secret);
  }
  await LinkService.adoptHarnessSession(session);
  const provisioned = await LinkService.provisionHarnessReceiver();
  return {
    pubky: provisioned.pubky,
    receiverPath: provisioned.receiverPath || LINK_RECEIVER_PATH,
  };
}

/**
 * Dev/e2e only: migrate the same identity to `homeserverZ32` (signup or
 * sign-in on 409), republish `_pubky`, adopt the new session, and rebind
 * Encrypted Link (same receiver Noise key, fresh peer handshakes).
 * Host-local data is not copied.
 */
export async function runMigrationTo(
  homeserverZ32: string,
  signupToken: string,
): Promise<MigrationSignupResult> {
  const token = signupToken.trim();
  const host = homeserverZ32.trim();
  if (!token) throw new Error("runMigrationTo: signup token is required");
  if (!host) throw new Error("runMigrationTo: homeserver z32 is required");
  const priorLive = getLiveSession();
  if (priorLive) {
    try {
      await PaykitLinkWeb.signOutSession(priorLive.handle);
    } catch {
      // Best-effort: cookie may already be replaced by migrate.
    }
  }
  const secret = requireIdentitySecret();
  let session;
  try {
    session = await PaykitLinkWeb.migrateHomeserverWithSecret(secret, host, token);
  } catch (error) {
    throw redactSignupToken(error, token);
  }
  await LinkService.adoptHarnessSession(session);
  const provisioned = await LinkService.rebindEncryptedLinkAfterHomeserverMigration();
  return {
    pubky: provisioned.pubky,
    receiverPath: provisioned.receiverPath || LINK_RECEIVER_PATH,
  };
}

export async function runMigrationRebindPeer(peerPubky: string): Promise<string> {
  return LinkService.rebindPeerLinkAfterHomeserverMigration(peerPubky.trim());
}

export async function runMigrationIdentity(): Promise<MigrationIdentity> {
  const pubky = (await KeyStore.getPubky()) ?? "";
  const receiver = pubky ? await StorageService.getLinkReceiver(pubky) : null;
  return {
    pubky,
    receiverPath: receiver?.receiverPath || LINK_RECEIVER_PATH,
  };
}

export async function runMigrationLocalBodies(peerPubky: string): Promise<string[]> {
  const owner = (await KeyStore.getPubky()) ?? "";
  if (!owner) return [];
  const rows = await StorageService.getLinkMessagesForConversation(
    owner,
    buildDmConversationId(peerPubky.trim()),
    50,
  );
  return rows.map((row) => row.body);
}

export async function runMigrationProbeMarker(
  peerPubky: string,
): Promise<{ found: boolean }> {
  const marker = await PaykitLinkWeb.getReceiverMarker(
    peerPubky.trim(),
    LINK_RECEIVER_PATH,
  );
  return { found: marker !== null };
}

export async function runMigrationPutAttachment(): Promise<{
  location: string;
  size: number;
}> {
  const plaintext = new TextEncoder().encode(MIGRATION_ATTACHMENT_PLAINTEXT);
  const uploaded = await encryptAndPutAttachment(plaintext);
  attachmentMaterial = {
    location: uploaded.location,
    key: uploaded.key,
    nonce: uploaded.nonce,
  };
  return { location: uploaded.location, size: uploaded.size };
}

export async function runMigrationGetAttachment(): Promise<AttachmentPresence> {
  if (!attachmentMaterial) {
    throw new Error("runMigrationPutAttachment must run first");
  }
  const location = attachmentMaterial.location;
  const raw = await getAttachmentCiphertext(location);
  if (raw === null) {
    return { location, found: false, bytesEqual: false };
  }
  const expected = new TextEncoder().encode(MIGRATION_ATTACHMENT_PLAINTEXT);
  let opened: Uint8Array | undefined;
  try {
    opened = await getAndDecryptAttachment(
      location,
      attachmentMaterial.key,
      attachmentMaterial.nonce,
    );
    let diff = 0;
    if (opened.byteLength !== expected.byteLength) {
      return { location, found: true, bytesEqual: false };
    }
    for (let i = 0; i < opened.byteLength; i += 1) {
      diff |= (opened[i] ?? 0) ^ (expected[i] ?? 0);
    }
    return { location, found: true, bytesEqual: diff === 0 };
  } finally {
    if (opened) zeroizeBytes(opened);
    zeroizeBytes(expected);
  }
}

export async function runMigrationPutPublicDoc(): Promise<{ path: string }> {
  const live = getLiveSession();
  if (!live) throw new Error("runMigrationPutPublicDoc: no live session");
  const body = new TextEncoder().encode(
    JSON.stringify({ kind: "migration-proof", at: Date.now() }),
  );
  await PaykitLinkWeb.putPublic(live.handle, MIGRATION_PUBLIC_DOC_PATH, body);
  return { path: MIGRATION_PUBLIC_DOC_PATH };
}

export async function runMigrationGetPublicDoc(
  ownerPubky: string,
): Promise<{ found: boolean }> {
  const fetched = await PaykitLinkWeb.publicGet(
    ownerPubky.trim(),
    MIGRATION_PUBLIC_DOC_PATH,
  );
  return { found: fetched !== undefined };
}

export async function runMigrationPublicGetCiphertext(
  location: string,
): Promise<{ found: boolean }> {
  const raw = await getAttachmentCiphertext(location.trim());
  return { found: raw !== null };
}

export { runDmEnsure, runDmSend, runDmSync } from "./dmHarness";
