import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AttachmentSecretMaterial,
  KeyStore,
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

  it("wraps and unwraps the session export", async () => {
    await KeyStore.setPubky(owner);
    await KeyStore.setSessionExport("export-blob");
    expect(await KeyStore.getSessionExport()).toBe("export-blob");
    const db = await openKeyStoreDb();
    const record = await readSecretRecord(db, "session-export:current");
    expect(record?.ciphertext.length).toBeGreaterThan(0);
    await KeyStore.deleteSessionExport();
    expect(await KeyStore.getSessionExport()).toBeNull();
  });

  it("wipes legacy handoff material and keeps the session export", async () => {
    await KeyStore.setPubky(owner);
    await KeyStore.setSessionExport("keep-me");
    const db = await openKeyStoreDb();
    await writeSecretRecord(db, "app-key:app-key", {
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array([1, 2, 3]),
      version: 1,
    });
    await writeSecretRecord(db, "pending-ring-handoff:ch", {
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array([4, 5, 6]),
      version: 1,
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("metadata", "readwrite");
      const req = tx.objectStore("metadata").put("{}", "pending-ring-handoff-pk:ch");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("meta write failed"));
    });
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    };
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    storage.setItem("hc.pendingHandoffLocator", "ch");
    await KeyStore.wipeLegacyRingMaterial();
    expect(await readSecretRecord(db, "app-key:app-key")).toBeUndefined();
    expect(await readSecretRecord(db, "pending-ring-handoff:ch")).toBeUndefined();
    expect(await KeyStore.getSessionExport()).toBe("keep-me");
    expect(storage.getItem("hc.pendingHandoffLocator")).toBeNull();
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

  it("reports hasPersistedSession from the pubky alone", async () => {
    expect(await KeyStore.hasPersistedSession()).toBe(false);
    await KeyStore.setPubky(owner);
    expect(await KeyStore.hasPersistedSession()).toBe(true);
  });

  it("AAD tamper fails closed for the session export", async () => {
    await KeyStore.setPubky(owner);
    await KeyStore.setSessionExport("export-blob");
    await KeyStore.setPubky("otherowner");
    expect(await KeyStore.getSessionExport()).toBeNull();
    await KeyStore.setPubky(owner);
    expect(await KeyStore.getSessionExport()).toBe("export-blob");
  });

  it("clear removes wrapped secrets and metadata", async () => {
    await KeyStore.setPubky(owner);
    await KeyStore.setHomeserver("https://example.com");
    await KeyStore.setSessionExport("export-blob");
    await KeyStore.setAttachmentSecret(owner, "sender1", "event1", {
      key: "k",
      nonce: "n",
      algorithm: "xchacha20-poly1305",
    });

    await KeyStore.clear();

    expect(await KeyStore.getPubky()).toBeNull();
    expect(await KeyStore.getHomeserver()).toBeNull();
    expect(await KeyStore.getSessionExport()).toBeNull();
    expect(
      await KeyStore.getAttachmentSecret(owner, "sender1", "event1"),
    ).toBeNull();
  });

  it("clearPubkyIfMatches only clears this tab's adoption nonce", async () => {
    const nonceA = await KeyStore.setPubky(owner);
    const nonceB = await KeyStore.setPubky(owner);
    await KeyStore.clearPubkyIfMatches(owner, nonceA);
    expect(await KeyStore.getPubky()).toBe(owner);
    await KeyStore.clearPubkyIfMatches(owner, nonceB);
    expect(await KeyStore.getPubky()).toBeNull();
  });
});
