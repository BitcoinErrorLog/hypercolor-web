/**
 * applyAttachmentInbound against real v13 SQL (better-sqlite3) and
 * WebKeyStore (fake-indexeddb). Secrets wrap after setPubky.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setDbForTests } from "../../db";
import { openMemoryDb } from "../../db/__tests__/betterSqliteAdapter";
import { runMigrations } from "../../db/migrations";
import {
  ATTACHMENT_ALGORITHM,
  ATTACHMENT_KEY_PLACEHOLDER,
  attachmentKeyRef,
  buildAttachmentEnvelope,
  buildAttachmentLocation,
  CHAT_ATTACHMENT_KIND,
} from "../../types/attachment";
import { buildDmConversationId } from "../../types/link";
import { KeyStore } from "../KeyStore";
import { StorageService } from "../StorageService";
import {
  applyAttachmentInbound,
  attachmentPreviewBody,
} from "./applyAttachmentInbound";
import { reconstructAttachmentWireJson } from "./redaction";
import { generateAttachmentKey } from "./xchacha";

const OWNER = "a".repeat(52);
const PEER = "z".repeat(52);
const VICTIM = "v".repeat(52);
const EVENT_ID = "00000000-0000-4000-8000-000000000001";
const ATTACHMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = 1_700_000_000_000;
const LIVE_NONCE = "B".repeat(32);

async function openKeyStoreDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("hypercolor-keystore");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("failed to open db"));
  });
}

async function readSecretRecord(
  db: IDBDatabase,
  key: string,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array; version: number } | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("secrets", "readonly");
    const store = tx.objectStore("secrets");
    const req = store.get(key);
    req.onsuccess = () =>
      resolve(
        req.result as
          | { iv: Uint8Array; ciphertext: Uint8Array; version: number }
          | undefined,
      );
    req.onerror = () => reject(req.error ?? new Error("failed to read secret"));
  });
}

function accessJson(senderPubky: string, key: string): string {
  return buildAttachmentEnvelope({
    eventId: EVENT_ID,
    sentAt: NOW - 50,
    location: buildAttachmentLocation(senderPubky, ATTACHMENT_ID),
    key,
    nonce: LIVE_NONCE,
    algorithm: ATTACHMENT_ALGORITHM,
    contentType: "image/jpeg",
    size: 12,
  }).json;
}

describe("applyAttachmentInbound (sqlite + KeyStore)", () => {
  beforeAll(async () => {
    await KeyStore.initKeyStore();
  });

  beforeEach(async () => {
    await KeyStore.clear();
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
  });

  afterEach(() => {
    setDbForTests(null);
  });

  it("wraps a content key in KeyStore only after setPubky", async () => {
    const key = generateAttachmentKey();
    const material = {
      key,
      nonce: LIVE_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    };

    await expect(
      KeyStore.setAttachmentSecret(OWNER, PEER, EVENT_ID, material),
    ).rejects.toThrow(/owner pubky not set/);

    await KeyStore.setPubky(OWNER);
    await KeyStore.setAttachmentSecret(OWNER, PEER, EVENT_ID, material);
    expect(await KeyStore.getAttachmentSecret(OWNER, PEER, EVENT_ID)).toEqual(
      material,
    );

    const idb = await openKeyStoreDb();
    const stored = await readSecretRecord(
      idb,
      `attachment:${KeyStore.attachmentKeyService(OWNER, PEER, EVENT_ID)}`,
    );
    expect(stored).toBeDefined();
    expect(stored!.version).toBe(1);
    expect(stored!.ciphertext.byteLength).toBeGreaterThan(0);
    const leaked = new TextDecoder().decode(stored!.ciphertext);
    expect(leaked).not.toContain(key);
    expect(leaked).not.toContain(LIVE_NONCE);
  });

  it("persists a redacted DM row and recovers the wrapped key", async () => {
    const key = generateAttachmentKey();
    await KeyStore.setPubky(OWNER);
    const rawJson = accessJson(PEER, key);

    const row = await applyAttachmentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER,
      peerPubky: PEER,
      rawJson,
      receivedAt: NOW,
    });

    expect(row).toEqual(
      expect.objectContaining({
        ownerPubky: OWNER,
        eventId: EVENT_ID,
        conversationId: buildDmConversationId(PEER),
        kind: CHAT_ATTACHMENT_KIND,
        body: attachmentPreviewBody({ contentType: "image/jpeg", size: 12 }),
        deliveryState: "delivered",
      }),
    );
    expect(row!.rawJson).toContain(ATTACHMENT_KEY_PLACEHOLDER);
    expect(row!.rawJson).not.toContain(key);
    expect(row!.rawJson).not.toContain(LIVE_NONCE);

    const persisted = await StorageService.getLinkMessage(
      OWNER,
      PEER,
      CHAT_ATTACHMENT_KIND,
      EVENT_ID,
    );
    expect(persisted?.rawJson).toContain(ATTACHMENT_KEY_PLACEHOLDER);
    expect(persisted?.rawJson).not.toContain(key);

    const attachment = await StorageService.getAttachment(OWNER, PEER, EVENT_ID);
    expect(attachment).toEqual(
      expect.objectContaining({
        eventId: EVENT_ID,
        senderPubky: PEER,
        keyRef: attachmentKeyRef(OWNER, PEER, EVENT_ID),
        localCachePath: null,
        location: buildAttachmentLocation(PEER, ATTACHMENT_ID),
        resolveState: "pending",
      }),
    );

    expect(await KeyStore.getAttachmentSecret(OWNER, PEER, EVENT_ID)).toEqual({
      key,
      nonce: LIVE_NONCE,
      algorithm: ATTACHMENT_ALGORITHM,
    });

    const rebuilt = await reconstructAttachmentWireJson(
      persisted!.rawJson,
      attachment!.keyRef,
    );
    expect(JSON.parse(rebuilt)).toEqual(JSON.parse(rawJson));
  });

  it("rejects a spoofed location and never stores secrets", async () => {
    const key = generateAttachmentKey();
    await KeyStore.setPubky(OWNER);
    const spoofed = accessJson(VICTIM, key);

    const row = await applyAttachmentInbound({
      ownerPubky: OWNER,
      senderPubky: PEER,
      peerPubky: PEER,
      rawJson: spoofed,
      receivedAt: NOW,
    });

    expect(row).toBeNull();
    expect(await StorageService.getAttachment(OWNER, PEER, EVENT_ID)).toBeNull();
    expect(await KeyStore.getAttachmentSecret(OWNER, PEER, EVENT_ID)).toBeNull();
  });
});
