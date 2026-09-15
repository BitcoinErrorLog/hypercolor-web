import { KeyStore } from "@/services/KeyStore";
import { StorageService } from "@/services/StorageService";
import { CHAT_MESSAGE_KIND } from "@/types/link";
import { signupStagingAndAdopt } from "../link/stagingSignup";
import {
  BackupService,
  configureBackupTransport,
  createHomeserverBackupTransport,
} from "./BackupService";

const PEER = "z".repeat(52);
const DISPLAY_NAME = "backup-restore-peer";
const MESSAGE_BODY = "backup-restore-body";

export const BACKUP_PROOF_PEER = PEER;
export const BACKUP_PROOF_DISPLAY_NAME = DISPLAY_NAME;
export const BACKUP_PROOF_BODY = MESSAGE_BODY;

export type BackupExportProof = {
  pubky: string;
  path: string;
  recoveryCode: string;
  contactPubky: string;
  displayName: string;
  body: string;
};

export type BackupRestoreProof = {
  displayName: string | null;
  contactPubky: string | null;
  body: string | null;
  ownerPubky: string;
};

export function installHomeserverBackupTransport(): void {
  configureBackupTransport(createHomeserverBackupTransport());
}

async function writeProofState(ownerPubky: string): Promise<void> {
  const sentAt = Date.now();
  await StorageService.upsertContact({
    pubky: PEER,
    ownerPubky,
    displayName: DISPLAY_NAME,
    trustScore: 0.5,
    isFollowing: true,
    isFollower: false,
    isMutual: false,
    addedManually: true,
    firstSeenAt: sentAt,
  });
  await StorageService.saveLinkMessage({
    ownerPubky,
    eventId: crypto.randomUUID(),
    conversationId: `dm:${PEER}`,
    peerPubky: PEER,
    senderPubky: ownerPubky,
    direction: "sent",
    kind: CHAT_MESSAGE_KIND,
    rawJson: "{}",
    body: MESSAGE_BODY,
    sentAt,
    receivedAt: null,
    deliveryState: "sent",
  });
}

/**
 * Dev/e2e only: signup, write local state, encrypt+PUT backup.
 * Recovery code is returned to the caller only — never logged.
 */
export async function runBackupSignupExport(
  signupToken: string,
): Promise<BackupExportProof> {
  installHomeserverBackupTransport();
  const { pubky } = await signupStagingAndAdopt(signupToken);
  await writeProofState(pubky);
  const { recoveryCode, path } = await BackupService.exportBackup();
  return {
    pubky,
    path,
    recoveryCode,
    contactPubky: PEER,
    displayName: DISPLAY_NAME,
    body: MESSAGE_BODY,
  };
}

/**
 * Dev/e2e only: fresh context restores from public GET + recovery code.
 * Does not log the recovery code.
 */
export async function runBackupRestore(input: {
  ownerPubky: string;
  recoveryCode: string;
}): Promise<BackupRestoreProof> {
  installHomeserverBackupTransport();
  await KeyStore.initKeyStore();
  await KeyStore.setPubky(input.ownerPubky);
  await BackupService.restoreBackup(input.recoveryCode);
  const contact = await StorageService.getContact(PEER, input.ownerPubky);
  const messages = await StorageService.getLinkMessagesForConversation(
    input.ownerPubky,
    `dm:${PEER}`,
  );
  return {
    displayName: contact?.displayName ?? null,
    contactPubky: contact?.pubky ?? null,
    body: messages[0]?.body ?? null,
    ownerPubky: input.ownerPubky,
  };
}
