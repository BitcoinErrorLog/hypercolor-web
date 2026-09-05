import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppCert,
  AppKeyPair,
  AttachmentSecretMaterial,
  InboxKeypair,
  KeyStore,
  TransportKeypair,
} from "./KeyStore";

const owner =
  "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("failed to read secret"));
  });
}

async function writeSecretRecord(
  db: IDBDatabase,
  key: string,
  record: { iv: Uint8Array; ciphertext: Uint8Array; version: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("secrets", "readwrite");
    const store = tx.objectStore("secrets");
    const req = store.put(record, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("failed to write secret"));
  });
}

describe("KeyStore", () => {
  beforeAll(async () => {
    await KeyStore.initKeyStore();
  });

  beforeEach(async () => {
    await KeyStore.clear();
  });

  it("refuses to operate before initKeyStore", async () => {
    vi.resetModules();
    const mod = await import("./KeyStore");
    await expect(mod.KeyStore.getPubky()).rejects.toThrow("not initialized");
    await mod.KeyStore.initKeyStore();
    await expect(mod.KeyStore.getPubky()).resolves.toBeNull();
  });

  it("persists the wrapping key as a non-extractable CryptoKey", async () => {
    const db = await openKeyStoreDb();
    const key = await new Promise<CryptoKey>((resolve, reject) => {
      const tx = db.transaction("wrappingKey", "readonly");
      const store = tx.objectStore("wrappingKey");
      const req = store.get("wrapping-key");
      req.onsuccess = () => resolve(req.result as CryptoKey);
      req.onerror = () => reject(req.error ?? new Error("failed to read key"));
    });
    expect(key.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("wraps and unwraps the app keypair", async () => {
    await KeyStore.setPubky(owner);
    const keypair: AppKeyPair = {
      publicKey: "apppub",
      secretKey: "appsec",
    };
    await KeyStore.setAppKeypair(keypair);
    expect(await KeyStore.getAppKeypair()).toEqual(keypair);
  });

  it("wraps and unwraps the inbox keypair", async () => {
    await KeyStore.setPubky(owner);
    const keypair: InboxKeypair = {
      publicKey: "inpub",
      secretKey: "insec",
    };
    await KeyStore.setInboxKeypair(keypair);
    expect(await KeyStore.getInboxKeypair()).toEqual(keypair);
  });

  it("wraps and unwraps the transport keypair", async () => {
    await KeyStore.setPubky(owner);
    const keypair: TransportKeypair = {
      publicKey: "trpub",
      secretKey: "trsec",
    };
    await KeyStore.setTransportKeypair(keypair);
    expect(await KeyStore.getTransportKeypair()).toEqual(keypair);
  });

  it("wraps and unwraps the AppCert and reports validity", async () => {
    await KeyStore.setPubky(owner);
    const cert: AppCert = {
      certBodyHex: "body",
      sigHex: "sig",
      certIdHex: "id",
      expiresAt: Math.floor(Date.now() / 1000) + 1000,
    };
    await KeyStore.setAppCert(cert);
    expect(await KeyStore.getAppCert()).toEqual(cert);
    expect(await KeyStore.isAppCertValid()).toBe(true);

    const expired: AppCert = {
      certBodyHex: "body",
      sigHex: "sig",
      certIdHex: "id2",
      expiresAt: Math.floor(Date.now() / 1000) - 1,
    };
    await KeyStore.setAppCert(expired);
    expect(await KeyStore.isAppCertValid()).toBe(false);
  });

  it("wraps and unwraps the pending ring handoff", async () => {
    await KeyStore.setPubky(owner);
    const deadline = Date.now() + 60_000;
    await KeyStore.setPendingRingHandoff("deadbeef", undefined, "ch-one", deadline);
    expect(await KeyStore.getPendingRingHandoff("ch-one")).toBe("deadbeef");
    await KeyStore.clearPendingRingHandoff("ch-one");
    expect(await KeyStore.getPendingRingHandoff("ch-one")).toBeNull();
  });

  it("wraps pending ring handoff before an owner pubky exists", async () => {
    const deadline = Date.now() + 60_000;
    await KeyStore.setPendingRingHandoff("cafebabe", "aa".repeat(32), "ch-pre", deadline);
    expect(await KeyStore.getPendingRingHandoff("ch-pre")).toBe("cafebabe");
    expect(await KeyStore.getPendingRingHandoffPublicKey("ch-pre")).toBe("aa".repeat(32));
    await KeyStore.setPubky(owner);
    expect(await KeyStore.getPendingRingHandoff("ch-pre")).toBe("cafebabe");
    await KeyStore.clearPendingRingHandoff("ch-pre");
    expect(await KeyStore.getPendingRingHandoff("ch-pre")).toBeNull();
    expect(await KeyStore.getPendingRingHandoffPublicKey("ch-pre")).toBeNull();
  });

  it("keeps two pending secrets keyed by channel id", async () => {
    const deadline = Date.now() + 60_000;
    await KeyStore.setPendingRingHandoff("secret-a", "aa".repeat(32), "ch-a", deadline);
    await KeyStore.setPendingRingHandoff("secret-b", "bb".repeat(32), "ch-b", deadline);
    expect(await KeyStore.getPendingRingHandoff("ch-a")).toBe("secret-a");
    expect(await KeyStore.getPendingRingHandoff("ch-b")).toBe("secret-b");
    expect(await KeyStore.getPendingRingHandoffPublicKey("ch-a")).toBe("aa".repeat(32));
    expect(await KeyStore.getPendingRingHandoffPublicKey("ch-b")).toBe("bb".repeat(32));
    await KeyStore.clearPendingRingHandoff("ch-a");
    expect(await KeyStore.getPendingRingHandoff("ch-a")).toBeNull();
    expect(await KeyStore.getPendingRingHandoff("ch-b")).toBe("secret-b");
  });

  it("expires a pending secret after its deadline", async () => {
    await KeyStore.setPendingRingHandoff("stale", "cc".repeat(32), "ch-stale", Date.now() - 1);
    expect(await KeyStore.getPendingRingHandoff("ch-stale")).toBeNull();
    expect(await KeyStore.getPendingRingHandoffPublicKey("ch-stale")).toBeNull();
  });

  it("wraps Encrypted Link snapshots under purpose link-snapshot", async () => {
    await KeyStore.setPubky(owner);
    const bytes = new Uint8Array([9, 8, 7, 6, 5]);
    const wrapped = await KeyStore.wrapLinkSnapshot(`${owner}:peer`, bytes);
    expect(wrapped.startsWith("HC1.")).toBe(true);
    expect(KeyStore.isWrappedLinkSnapshot(wrapped)).toBe(true);
    expect(await KeyStore.unwrapLinkSnapshot(wrapped)).toEqual(bytes);
    const db = await openKeyStoreDb();
    const record = await readSecretRecord(db, `link-snapshot:${owner}:peer`);
    expect(record).toBeDefined();
    expect(record?.ciphertext.length).toBeGreaterThan(0);
    const tampered = `${wrapped.slice(0, -2)}aa`;
    await expect(KeyStore.unwrapLinkSnapshot(tampered)).rejects.toThrow(
      /link-snapshot/,
    );
  });

  it("wraps the receiver Noise secret under purpose receiver-noise", async () => {
    await KeyStore.setPubky(owner);
    const secret = new Uint8Array([1, 2, 3, 4]);
    await KeyStore.setReceiverNoiseSecret("hypercolor/wallet", secret);
    expect(await KeyStore.getReceiverNoiseSecret("hypercolor/wallet")).toEqual(
      secret,
    );
    await KeyStore.deleteReceiverNoiseSecret("hypercolor/wallet");
    expect(await KeyStore.getReceiverNoiseSecret("hypercolor/wallet")).toBeNull();
  });

  it("wraps and unwraps attachment secrets", async () => {
    await KeyStore.setPubky(owner);
    const material: AttachmentSecretMaterial = {
      key: "k",
      nonce: "n",
      algorithm: "xchacha20-poly1305",
    };
    await KeyStore.setAttachmentSecret(owner, "sender1", "event1", material);
    expect(
      await KeyStore.getAttachmentSecret(owner, "sender1", "event1"),
    ).toEqual(material);
  });

  it("does not persist a homeserver bearer or expose session-secret APIs", () => {
    expect(KeyStore).not.toHaveProperty("setSessionSecret");
    expect(KeyStore).not.toHaveProperty("getSessionSecret");
  });

  it("stores non-secret metadata in plaintext", async () => {
    await KeyStore.setPubky(owner);
    await KeyStore.setHomeserver("https://hs.example.com");
    await KeyStore.setLinkSession("session-alias-123");
    expect(await KeyStore.getPubky()).toBe(owner);
    expect(await KeyStore.getHomeserver()).toBe("https://hs.example.com");
    expect(await KeyStore.getLinkSession()).toBe("session-alias-123");
    await KeyStore.deleteLinkSession();
    expect(await KeyStore.getLinkSession()).toBeNull();
  });

  it("reports hasPersistedSession", async () => {
    expect(await KeyStore.hasPersistedSession()).toBe(false);
    await KeyStore.setPubky(owner);
    expect(await KeyStore.hasPersistedSession()).toBe(false);
    await KeyStore.setAppKeypair({ publicKey: "pub", secretKey: "sec" });
    expect(await KeyStore.hasPersistedSession()).toBe(true);
  });

  it("AAD tamper fails closed", async () => {
    await KeyStore.setPubky(owner);
    const appKey: AppKeyPair = {
      publicKey: "pub",
      secretKey: "sec",
    };
    await KeyStore.setAppKeypair(appKey);

    // Owner tamper: changing the owner metadata invalidates the AAD binding.
    await KeyStore.setPubky("otherowner");
    expect(await KeyStore.getAppKeypair()).toBeNull();

    // Restore owner and verify decryption works again.
    await KeyStore.setPubky(owner);
    expect(await KeyStore.getAppKeypair()).toEqual(appKey);

    // Purpose tamper: copy ciphertext under a different purpose key.
    const db = await openKeyStoreDb();
    const record = await readSecretRecord(db, "app-key:app-key");
    expect(record).toBeDefined();
    await writeSecretRecord(db, "inbox:inbox", record!);
    expect(await KeyStore.getInboxKeypair()).toBeNull();

    // Alias tamper: ciphertext under the correct purpose but wrong alias.
    await writeSecretRecord(db, "app-key:tampered", record!);
    // No public API reads alias "tampered"; the legitimate entry remains valid.
    expect(await KeyStore.getAppKeypair()).toEqual(appKey);
  });

  it("clear removes wrapped secrets and metadata", async () => {
    await KeyStore.setPubky(owner);
    await KeyStore.setHomeserver("https://example.com");
    await KeyStore.setAppKeypair({ publicKey: "pub", secretKey: "sec" });
    await KeyStore.setAttachmentSecret(owner, "sender1", "event1", {
      key: "k",
      nonce: "n",
      algorithm: "xchacha20-poly1305",
    });

    await KeyStore.clear();

    expect(await KeyStore.getPubky()).toBeNull();
    expect(await KeyStore.getHomeserver()).toBeNull();
    expect(await KeyStore.getAppKeypair()).toBeNull();
    expect(
      await KeyStore.getAttachmentSecret(owner, "sender1", "event1"),
    ).toBeNull();
  });
});
