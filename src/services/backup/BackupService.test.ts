import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setDbForTests } from "../../db";
import { openMemoryDb } from "../../db/__tests__/betterSqliteAdapter";
import { runMigrations } from "../../db/migrations";
import { CHAT_MESSAGE_KIND } from "../../types/link";
import { KeyStore } from "../KeyStore";
import { StorageService } from "../StorageService";
import {
  BACKUP_AEAD_ALGORITHM,
  BackupService,
  backupLatestUrl,
  configureBackupTransport,
  decodeRecoveryCode,
  decryptOwnerBackup,
  encodeKey,
  encryptOwnerBackup,
  generateRecoveryCode,
  OWNER_BACKUP_VERSION,
  parseBackupBlob,
  RECOVERY_CODE_BYTES,
  sealOwnerBackup,
  stringifyBackupBlob,
  xchachaOpen,
  xchachaSeal,
} from "./BackupService";
import type { OwnerBackupSnapshot } from "./snapshot";

const OWNER = "a".repeat(52);
const PEER = "z".repeat(52);
const OTHER = "b".repeat(52);
const EVENT = "00000000-0000-4000-8000-000000000001";

/** Mobile BackupService.test.ts recovery-code fixture: 32 zero bytes, base64url no pad. */
const MOBILE_ZERO_RECOVERY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const uploaded = new Map<string, string>();

function emptySnapshot(
  ownerPubky: string,
  extras: Partial<OwnerBackupSnapshot> = {},
): OwnerBackupSnapshot {
  return {
    version: OWNER_BACKUP_VERSION,
    ownerPubky,
    exportedAt: 1_700_000_000_000,
    contacts: [],
    messageRequests: [],
    linkMessages: [],
    readCursors: [],
    groupChannels: [],
    groupMembers: [],
    groupMessages: [],
    paymentRequests: [],
    tipEndpoints: [],
    attachments: [],
    ...extras,
  };
}

function loadCrossRestoreFixture(): {
  aad: string;
  ownerPubky: string;
  recoveryCode: string;
  blobJson: string;
  snapshot: OwnerBackupSnapshot;
  expected: {
    version: number;
    ownerPubky: string;
    exportedAt: number;
    contactPubky: string;
    contactDisplayName: string;
  };
} {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    "__fixtures__",
    "cross-restore.json",
  );
  return JSON.parse(readFileSync(path, "utf8")) as ReturnType<
    typeof loadCrossRestoreFixture
  >;
}

describe("backup recovery-code format", () => {
  it("encodes 32 zero bytes as the mobile test recovery code", () => {
    expect(encodeKey(new Uint8Array(RECOVERY_CODE_BYTES))).toBe(
      MOBILE_ZERO_RECOVERY,
    );
    expect(decodeRecoveryCode(MOBILE_ZERO_RECOVERY)).toEqual(
      new Uint8Array(RECOVERY_CODE_BYTES),
    );
    expect(MOBILE_ZERO_RECOVERY).toHaveLength(43);
  });

  it("generateRecoveryCode is 32 random bytes, base64url, no padding", () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toMatch(/[=+/]/);
    expect(decodeRecoveryCode(a)).toHaveLength(RECOVERY_CODE_BYTES);
    expect(a).not.toBe(b);
  });
});

describe("encryptOwnerBackup / decryptOwnerBackup", () => {
  const snapshot = emptySnapshot(OWNER, {
    contacts: [
      {
        pubky: PEER,
        ownerPubky: OWNER,
        displayName: "Peer",
        trustScore: 0.5,
        isFollowing: true,
        isFollower: false,
        isMutual: false,
        addedManually: true,
        firstSeenAt: 10,
      },
    ],
  });

  it("round-trips with AAD bound to backupLatestUrl(owner)", () => {
    const path = backupLatestUrl(OWNER);
    expect(path).toBe(
      `pubky://${OWNER}/pub/hypercolor.app/v1/backup/latest`,
    );

    const { recoveryCode, blob, path: written } = encryptOwnerBackup(
      snapshot,
      OWNER,
    );
    expect(written).toBe(path);
    const parsed = parseBackupBlob(blob);
    expect(parsed.version).toBe(1);
    expect(parsed.algorithm).toBe(BACKUP_AEAD_ALGORITHM);

    const restored = decryptOwnerBackup(blob, `  ${recoveryCode}  `, OWNER);
    expect(restored).toEqual(snapshot);
  });

  it("fails closed on the wrong recovery code", () => {
    const { blob } = encryptOwnerBackup(snapshot, OWNER);
    const other = generateRecoveryCode();
    expect(() => decryptOwnerBackup(blob, other, OWNER)).toThrow(
      "Backup decrypt failed",
    );
  });

  it("fails closed on the wrong AAD (different owner path)", () => {
    const { recoveryCode, blob } = encryptOwnerBackup(snapshot, OWNER);
    expect(() => decryptOwnerBackup(blob, recoveryCode, OTHER)).toThrow(
      "Backup decrypt failed",
    );
  });

  it("fails closed when AAD bytes are swapped at the seal layer", () => {
    const key = decodeRecoveryCode(generateRecoveryCode());
    const nonce = new Uint8Array(24);
    crypto.getRandomValues(nonce);
    const plaintext = new TextEncoder().encode(JSON.stringify(snapshot));
    const sealed = xchachaSeal(
      plaintext,
      key,
      nonce,
      new TextEncoder().encode(backupLatestUrl(OWNER)),
    );
    expect(() =>
      xchachaOpen(
        sealed,
        key,
        nonce,
        new TextEncoder().encode(backupLatestUrl(OTHER)),
      ),
    ).toThrow("Backup decrypt failed");
  });

  it("rejects a snapshot whose owner does not match the AAD owner", () => {
    const key = decodeRecoveryCode(generateRecoveryCode());
    const nonce = new Uint8Array(24);
    crypto.getRandomValues(nonce);
    const foreign = emptySnapshot(OTHER);
    const blob = stringifyBackupBlob(
      sealOwnerBackup(foreign, key, nonce, backupLatestUrl(OWNER)),
    );
    expect(() =>
      decryptOwnerBackup(blob, encodeKey(key), OWNER),
    ).toThrow("Backup belongs to a different account");
  });
});

describe("cross-restore fixture (mobile ingest)", () => {
  it("decrypts the checked-in vector and matches expected snapshot fields", () => {
    const fixture = loadCrossRestoreFixture();
    expect(fixture.aad).toBe(backupLatestUrl(fixture.ownerPubky));
    expect(fixture.aad).toBe(
      `pubky://${fixture.ownerPubky}/pub/hypercolor.app/v1/backup/latest`,
    );

    const restored = decryptOwnerBackup(
      fixture.blobJson,
      fixture.recoveryCode,
      fixture.ownerPubky,
    );
    expect(restored.version).toBe(fixture.expected.version);
    expect(restored.ownerPubky).toBe(fixture.expected.ownerPubky);
    expect(restored.exportedAt).toBe(fixture.expected.exportedAt);
    expect(restored.contacts[0]?.pubky).toBe(fixture.expected.contactPubky);
    expect(restored.contacts[0]?.displayName).toBe(
      fixture.expected.contactDisplayName,
    );
    expect(restored).toEqual(fixture.snapshot);
  });
});

describe("BackupService", () => {
  beforeAll(async () => {
    await KeyStore.initKeyStore();
  });

  beforeEach(async () => {
    uploaded.clear();
    await KeyStore.clear();
    await KeyStore.setPubky(OWNER);
    configureBackupTransport({
      putOwner: async (url, content) => {
        uploaded.set(url, content);
      },
      getPublic: async (url) => uploaded.get(url) ?? null,
    });
  });

  afterEach(() => {
    configureBackupTransport(null);
    setDbForTests(null);
  });

  it("refuses export/restore when the upload hook is missing", async () => {
    configureBackupTransport(null);
    await expect(BackupService.exportBackup()).rejects.toThrow(
      "homeserver transport is not configured",
    );
    await expect(BackupService.restoreBackup(MOBILE_ZERO_RECOVERY)).rejects.toThrow(
      "homeserver transport is not configured",
    );
  });

  it("export encrypts with mobile AAD and restore rehydrates owner SQL rows", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OWNER,
      displayName: "Peer",
      trustScore: 0.5,
      isFollowing: true,
      isFollower: false,
      isMutual: false,
      addedManually: true,
      firstSeenAt: 10,
    });
    await StorageService.upsertContact({
      pubky: PEER,
      ownerPubky: OTHER,
      displayName: "Foreign",
      trustScore: 0.9,
      isFollowing: false,
      isFollower: true,
      isMutual: false,
      addedManually: false,
      firstSeenAt: 11,
    });
    await StorageService.saveLinkMessage({
      ownerPubky: OWNER,
      eventId: EVENT,
      conversationId: `dm:${PEER}`,
      peerPubky: PEER,
      senderPubky: OWNER,
      direction: "sent",
      kind: CHAT_MESSAGE_KIND,
      rawJson: "{}",
      body: "hello from owner",
      sentAt: 20,
      receivedAt: null,
      deliveryState: "sent",
    });
    await StorageService.setLinkReadCursor(OWNER, `dm:${PEER}`, 20);

    const result = await BackupService.exportBackup();
    expect(result.path).toBe(backupLatestUrl(OWNER));
    expect(decodeRecoveryCode(result.recoveryCode)).toHaveLength(32);
    const stored = uploaded.get(result.path);
    expect(stored).toBeTruthy();
    const blob = parseBackupBlob(stored!);
    expect(blob.algorithm).toBe("XChaCha20Poly1305");

    await StorageService.clearAccountData(OWNER);
    expect(await StorageService.getContact(PEER, OWNER)).toBeNull();
    expect(
      await StorageService.getLinkMessagesForConversation(OWNER, `dm:${PEER}`),
    ).toEqual([]);
    expect(await StorageService.getContact(PEER, OTHER)).toEqual(
      expect.objectContaining({ displayName: "Foreign" }),
    );

    await BackupService.restoreBackup(`  ${result.recoveryCode}  `);

    expect(await StorageService.getContact(PEER, OWNER)).toEqual(
      expect.objectContaining({ displayName: "Peer", ownerPubky: OWNER }),
    );
    expect(await StorageService.getContact(PEER, OTHER)).toEqual(
      expect.objectContaining({ displayName: "Foreign" }),
    );
    const msgs = await StorageService.getLinkMessagesForConversation(
      OWNER,
      `dm:${PEER}`,
    );
    expect(msgs.map((m) => m.body)).toEqual(["hello from owner"]);
    expect(await StorageService.getLinkReadCursor(OWNER, `dm:${PEER}`)).toBe(20);
  });
});
