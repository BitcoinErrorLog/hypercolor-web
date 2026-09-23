import { base64urlnopad } from "@scure/base";

/**
 * WebKeyStore for Hypercolor web.
 *
 * Browser-equivalent of mobile `src/services/KeyStore.ts`. Secrets are stored
 * as AES-GCM ciphertext wrapped by a single non-extractable AES-GCM CryptoKey
 * persisted in IndexedDB. The wrapping key is never exportable to JS.
 *
 * Every wrapped ciphertext carries AAD binding it to
 * `{ ownerPubky, purpose, alias }`, so ciphertext cannot be replayed under a
 * different owner, purpose, or alias.
 *
 * Non-secret metadata (pubky, homeserver, link_session alias, receiver path)
 * is stored in IndexedDB plaintext. Session export bytes are AES-GCM wrapped
 * under purpose `session-export`.
 */

const DB_NAME = "hypercolor-keystore";
const DB_VERSION = 1;

const STORE_METADATA = "metadata";
const STORE_SECRETS = "secrets";
const STORE_WRAPPING_KEY = "wrappingKey";

const WRAPPING_KEY_ID = "wrapping-key";

const KEY_PUBKY = "pubky";
const KEY_PUBKY_ADOPTION = "pubky-adoption";
const KEY_HOMESERVER = "homeserver";
const KEY_LINK_SESSION = "link_session";

const ATTACHMENT_INDEX_PREFIX = "attachment-index:";

const PURPOSE_SESSION_EXPORT = "session-export";
const SESSION_EXPORT_ALIAS = "current";
const PURPOSE_RECEIVER_NOISE = "receiver-noise";
const PURPOSE_ATTACHMENT = "attachment";
const PURPOSE_LINK_SNAPSHOT = "link-snapshot";

const LEGACY_SECRET_PREFIXES = [
  "app-key:",
  "inbox:",
  "transport:",
  "app-cert:",
  "noise-seed:",
  "pending-ring-handoff:",
] as const;

const PENDING_LOCATOR_KEY = "hc.pendingHandoffLocator";

const LINK_SNAPSHOT_PREFIX = "HC1.";

const WRAP_VERSION = 1;

export interface AttachmentSecretMaterial {
  key: string;
  nonce: string;
  algorithm: string;
  thumbnail?: { key: string; nonce: string };
}

export interface AttachmentSecretRef {
  senderPubky: string;
  eventId: string;
}

interface AadBinding {
  ownerPubky: string;
  purpose: string;
  alias: string;
}

interface WrappedSecretRecord {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  version: number;
}

let _initPromise: Promise<void> | null = null;
let _db: IDBDatabase | null = null;
let _wrappingKey: CryptoKey | null = null;

function assertCrypto(): void {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.subtle !== "object" || crypto.subtle === null) {
    throw new Error(
      "KeyStore: crypto.subtle is unavailable; refusing to operate without Web Crypto.",
    );
  }
  if (typeof crypto.getRandomValues !== "function") {
    throw new Error(
      "KeyStore: crypto.getRandomValues is unavailable; refusing to operate without a CSPRNG.",
    );
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("KeyStore: failed to open IndexedDB"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_METADATA)) {
        db.createObjectStore(STORE_METADATA);
      }
      if (!db.objectStoreNames.contains(STORE_SECRETS)) {
        db.createObjectStore(STORE_SECRETS);
      }
      if (!db.objectStoreNames.contains(STORE_WRAPPING_KEY)) {
        db.createObjectStore(STORE_WRAPPING_KEY);
      }
    };
  });
}

async function getWrappingKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WRAPPING_KEY, "readonly");
    const store = tx.objectStore(STORE_WRAPPING_KEY);
    const req = store.get(WRAPPING_KEY_ID);
    req.onsuccess = () => {
      const result = req.result;
      if (
        result &&
        typeof result === "object" &&
        (result as CryptoKey).type === "secret" &&
        (result as CryptoKey).algorithm &&
        ((result as CryptoKey).algorithm as AesKeyAlgorithm).name === "AES-GCM"
      ) {
        resolve(result as CryptoKey);
      } else {
        resolve(null);
      }
    };
    req.onerror = () =>
      reject(req.error ?? new Error("KeyStore: failed to read wrapping key"));
  });
}

async function getOrCreateWrappingKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await getWrappingKey(db);
  if (existing) return existing;

  const key = await globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_WRAPPING_KEY, "readwrite");
    const store = tx.objectStore(STORE_WRAPPING_KEY);
    const req = store.put(key, WRAPPING_KEY_ID);
    req.onsuccess = () => resolve();
    req.onerror = () =>
      reject(req.error ?? new Error("KeyStore: failed to persist wrapping key"));
  });

  return key;
}

function ensureInitialized(): IDBDatabase {
  if (!_db) {
    throw new Error("KeyStore: not initialized. Call initKeyStore() first.");
  }
  return _db;
}

async function getMetadata(key: string): Promise<string | null> {
  const db = ensureInitialized();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_METADATA, "readonly");
    const store = tx.objectStore(STORE_METADATA);
    const req = store.get(key);
    req.onsuccess = () => {
      const value = req.result;
      resolve(typeof value === "string" ? value : null);
    };
    req.onerror = () =>
      reject(req.error ?? new Error(`KeyStore: failed to read metadata ${key}`));
  });
}

async function setMetadata(key: string, value: string): Promise<void> {
  const db = ensureInitialized();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_METADATA, "readwrite");
    const store = tx.objectStore(STORE_METADATA);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () =>
      reject(req.error ?? new Error(`KeyStore: failed to write metadata ${key}`));
  });
}

async function deleteMetadata(key: string): Promise<void> {
  const db = ensureInitialized();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_METADATA, "readwrite");
    const store = tx.objectStore(STORE_METADATA);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () =>
      reject(req.error ?? new Error(`KeyStore: failed to delete metadata ${key}`));
  });
}

function secretKey(purpose: string, alias: string): string {
  return `${purpose}:${alias}`;
}

function buildAad(ownerPubky: string, purpose: string, alias: string): Uint8Array {
  const binding: AadBinding = { ownerPubky, purpose, alias };
  return new TextEncoder().encode(JSON.stringify(binding));
}

function aadOwnerForPurpose(_purpose: string, currentOwner: string | null): string | null {
  return currentOwner;
}

async function wrapSecret(
  purpose: string,
  alias: string,
  plaintext: Uint8Array,
): Promise<void> {
  if (!_wrappingKey) {
    throw new Error("KeyStore: not initialized. Call initKeyStore() first.");
  }
  const db = ensureInitialized();
  const owner = aadOwnerForPurpose(purpose, await getMetadata(KEY_PUBKY));
  if (!owner) {
    throw new Error("KeyStore: owner pubky not set; cannot bind secret AAD.");
  }
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const aad = buildAad(owner, purpose, alias);
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: aad as BufferSource,
      },
      _wrappingKey,
      plaintext as BufferSource,
    ),
  );
  const record: WrappedSecretRecord = { iv, ciphertext, version: WRAP_VERSION };
  const key = secretKey(purpose, alias);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SECRETS, "readwrite");
    const store = tx.objectStore(STORE_SECRETS);
    const req = store.put(record, key);
    req.onsuccess = () => resolve();
    req.onerror = () =>
      reject(req.error ?? new Error(`KeyStore: failed to write secret ${key}`));
  });
}

async function unwrapSecret(
  purpose: string,
  alias: string,
): Promise<Uint8Array | null> {
  if (!_wrappingKey) {
    throw new Error("KeyStore: not initialized. Call initKeyStore() first.");
  }
  const db = ensureInitialized();
  const owner = aadOwnerForPurpose(purpose, await getMetadata(KEY_PUBKY));
  if (!owner) return null;
  const key = secretKey(purpose, alias);
  const record = await new Promise<WrappedSecretRecord | undefined>(
    (resolve, reject) => {
      const tx = db.transaction(STORE_SECRETS, "readonly");
      const store = tx.objectStore(STORE_SECRETS);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as WrappedSecretRecord | undefined);
      req.onerror = () =>
        reject(req.error ?? new Error(`KeyStore: failed to read secret ${key}`));
    },
  );
  if (!record) return null;
  const aad = buildAad(owner, purpose, alias);
  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: record.iv as BufferSource,
        additionalData: aad as BufferSource,
      },
      _wrappingKey,
      record.ciphertext as BufferSource,
    );
    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}

async function deleteSecret(purpose: string, alias: string): Promise<void> {
  const db = ensureInitialized();
  const key = secretKey(purpose, alias);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SECRETS, "readwrite");
    const store = tx.objectStore(STORE_SECRETS);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () =>
      reject(req.error ?? new Error(`KeyStore: failed to delete secret ${key}`));
  });
}

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Must be called once before any KeyStore reads or writes.
 * Opens IndexedDB, creates object stores, and generates or loads the
 * non-extractable AES-GCM wrapping key. Fail-closed if Web Crypto is missing.
 */
export async function initKeyStore(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    try {
      assertCrypto();
      const db = await openDb();
      const key = await getOrCreateWrappingKey(db);
      _db = db;
      _wrappingKey = key;
      await wipeLegacyRingMaterial();
    } catch (error) {
      _initPromise = null;
      throw error;
    }
  })();
  return _initPromise;
}

async function listStoreKeys(storeName: string): Promise<IDBValidKey[]> {
  const db = ensureInitialized();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error(`KeyStore: failed to list ${storeName}`));
  });
}

async function deleteSecretKey(key: string): Promise<void> {
  const db = ensureInitialized();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SECRETS, "readwrite");
    const req = tx.objectStore(STORE_SECRETS).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () =>
      reject(req.error ?? new Error(`KeyStore: failed to delete secret ${key}`));
  });
}

/** Drop fork handoff and delegated-key material. Does not touch session-export. */
export async function wipeLegacyRingMaterial(): Promise<void> {
  for (const key of await listStoreKeys(STORE_SECRETS)) {
    if (typeof key !== "string") continue;
    if (LEGACY_SECRET_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      await deleteSecretKey(key);
    }
  }
  for (const key of await listStoreKeys(STORE_METADATA)) {
    if (typeof key === "string" && key.startsWith("pending-ring-handoff")) {
      await deleteMetadata(key);
    }
  }
  try {
    globalThis.sessionStorage?.removeItem(PENDING_LOCATOR_KEY);
    globalThis.localStorage?.removeItem(PENDING_LOCATOR_KEY);
  } catch {
    // Storage can be unavailable in non-browser tests.
  }
}

export async function setSessionExport(exported: string): Promise<void> {
  await wrapSecret(
    PURPOSE_SESSION_EXPORT,
    SESSION_EXPORT_ALIAS,
    new TextEncoder().encode(exported),
  );
}

export async function getSessionExport(): Promise<string | null> {
  const plaintext = await unwrapSecret(PURPOSE_SESSION_EXPORT, SESSION_EXPORT_ALIAS);
  if (!plaintext) return null;
  const value = new TextDecoder().decode(plaintext);
  return value.length > 0 ? value : null;
}

export async function deleteSessionExport(): Promise<void> {
  await deleteSecret(PURPOSE_SESSION_EXPORT, SESSION_EXPORT_ALIAS);
}

// ─── Pubky public key (plaintext metadata — not sensitive) ────────────────────

function randomAdoptionNonce(): string {
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export async function setPubky(pubky: string): Promise<string> {
  const { setTabLockOwner } = await import("@/services/tabLock");
  setTabLockOwner(pubky);
  const adoptionNonce = randomAdoptionNonce();
  const db = ensureInitialized();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_METADATA, "readwrite");
    const store = tx.objectStore(STORE_METADATA);
    store.put(pubky, KEY_PUBKY);
    store.put(adoptionNonce, KEY_PUBKY_ADOPTION);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("KeyStore: failed to write pubky"));
  });
  return adoptionNonce;
}

export async function getPubky(): Promise<string | null> {
  return getMetadata(KEY_PUBKY);
}

/** Un-set the signed-in pubky only if it still equals `expected` with this tab's adoption nonce. */
export async function clearPubkyIfMatches(expected: string, adoptionNonce: string): Promise<void> {
  const db = ensureInitialized();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_METADATA, "readwrite");
    const store = tx.objectStore(STORE_METADATA);
    const pubkyReq = store.get(KEY_PUBKY);
    const nonceReq = store.get(KEY_PUBKY_ADOPTION);
    const maybeClear = () => {
      if (pubkyReq.readyState !== "done" || nonceReq.readyState !== "done") return;
      const current = typeof pubkyReq.result === "string" ? pubkyReq.result : null;
      const storedNonce = typeof nonceReq.result === "string" ? nonceReq.result : null;
      if (current !== expected || storedNonce !== adoptionNonce) return;
      store.delete(KEY_PUBKY);
      store.delete(KEY_PUBKY_ADOPTION);
    };
    pubkyReq.onsuccess = maybeClear;
    nonceReq.onsuccess = maybeClear;
    pubkyReq.onerror = () =>
      reject(pubkyReq.error ?? new Error("KeyStore: failed to read pubky"));
    nonceReq.onerror = () =>
      reject(nonceReq.error ?? new Error("KeyStore: failed to read pubky adoption"));
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("KeyStore: failed to clear matching pubky"));
  });
}

// ─── Homeserver (plaintext metadata) ──────────────────────────────────────────

export async function setHomeserver(homeserver: string): Promise<void> {
  await setMetadata(KEY_HOMESERVER, homeserver);
}

export async function getHomeserver(): Promise<string | null> {
  return getMetadata(KEY_HOMESERVER);
}

// ─── Link session alias (Paykit Encrypted Links — plaintext metadata) ─────────

export async function setLinkSession(sessionAlias: string): Promise<void> {
  await setMetadata(KEY_LINK_SESSION, sessionAlias);
}

export async function getLinkSession(): Promise<string | null> {
  return getMetadata(KEY_LINK_SESSION);
}

export async function deleteLinkSession(): Promise<void> {
  await deleteMetadata(KEY_LINK_SESSION);
}

export async function setReceiverNoiseSecret(
  alias: string,
  secret: Uint8Array,
): Promise<void> {
  await wrapSecret(PURPOSE_RECEIVER_NOISE, alias, secret);
}

export async function getReceiverNoiseSecret(
  alias: string,
): Promise<Uint8Array | null> {
  return unwrapSecret(PURPOSE_RECEIVER_NOISE, alias);
}

export async function deleteReceiverNoiseSecret(alias: string): Promise<void> {
  await deleteSecret(PURPOSE_RECEIVER_NOISE, alias);
}

function encodeLinkSnapshotEnvelope(
  alias: string,
  record: WrappedSecretRecord,
): string {
  const payload = new Uint8Array(1 + record.iv.length + record.ciphertext.length);
  payload[0] = record.version;
  payload.set(record.iv, 1);
  payload.set(record.ciphertext, 1 + record.iv.length);
  return `${LINK_SNAPSHOT_PREFIX}${base64urlnopad.encode(new TextEncoder().encode(alias))}.${base64urlnopad.encode(payload)}`;
}

function decodeLinkSnapshotEnvelope(
  wrapped: string,
): { alias: string; iv: Uint8Array; ciphertext: Uint8Array } | null {
  if (!wrapped.startsWith(LINK_SNAPSHOT_PREFIX)) return null;
  const rest = wrapped.slice(LINK_SNAPSHOT_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null;
  try {
    const alias = new TextDecoder().decode(
      base64urlnopad.decode(rest.slice(0, dot)),
    );
    const payload = base64urlnopad.decode(rest.slice(dot + 1));
    if (payload.length < 13) return null;
    const version = payload[0];
    if (version !== WRAP_VERSION) return null;
    return {
      alias,
      iv: payload.slice(1, 13),
      ciphertext: payload.slice(13),
    };
  } catch {
    return null;
  }
}

async function readSecretRecord(
  purpose: string,
  alias: string,
): Promise<WrappedSecretRecord | undefined> {
  const db = ensureInitialized();
  const key = secretKey(purpose, alias);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SECRETS, "readonly");
    const store = tx.objectStore(STORE_SECRETS);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as WrappedSecretRecord | undefined);
    req.onerror = () =>
      reject(req.error ?? new Error(`KeyStore: failed to read secret ${key}`));
  });
}

/**
 * Wrap Encrypted Link snapshot bytes (purpose `link-snapshot`) and return an
 * opaque string for SQLite. The inner wasm bytes are never inspected.
 */
export async function wrapLinkSnapshot(
  alias: string,
  plaintext: Uint8Array,
): Promise<string> {
  await wrapSecret(PURPOSE_LINK_SNAPSHOT, alias, plaintext);
  const record = await readSecretRecord(PURPOSE_LINK_SNAPSHOT, alias);
  if (!record) {
    throw new Error("KeyStore: link-snapshot wrap failed to persist");
  }
  return encodeLinkSnapshotEnvelope(alias, record);
}

/**
 * Unwrap an opaque snapshot string produced by {@link wrapLinkSnapshot}.
 * Decrypts the envelope; does not parse the recovered wasm bytes.
 */
export async function unwrapLinkSnapshot(wrapped: string): Promise<Uint8Array> {
  const parsed = decodeLinkSnapshotEnvelope(wrapped);
  if (!parsed) {
    throw new Error("KeyStore: malformed link-snapshot envelope");
  }
  if (!_wrappingKey) {
    throw new Error("KeyStore: not initialized. Call initKeyStore() first.");
  }
  const owner = await getMetadata(KEY_PUBKY);
  if (!owner) {
    throw new Error("KeyStore: owner pubky not set; cannot unwrap link snapshot.");
  }
  const aad = buildAad(owner, PURPOSE_LINK_SNAPSHOT, parsed.alias);
  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: parsed.iv as BufferSource,
        additionalData: aad as BufferSource,
      },
      _wrappingKey,
      parsed.ciphertext as BufferSource,
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new Error("KeyStore: link-snapshot unwrap failed");
  }
}

export async function deleteLinkSnapshot(wrapped: string): Promise<void> {
  const parsed = decodeLinkSnapshotEnvelope(wrapped);
  if (!parsed) return;
  await deleteSecret(PURPOSE_LINK_SNAPSHOT, parsed.alias);
}

export function isWrappedLinkSnapshot(value: string): boolean {
  return value.startsWith(LINK_SNAPSHOT_PREFIX);
}

// ─── Attachment AEAD material (wrapped, keyed by owner + sender + event) ──────

export function attachmentKeyService(
  ownerPubky: string,
  senderPubky: string,
  eventId: string,
): string {
  return `hypercolor-attachment-key:${ownerPubky}:${senderPubky}:${eventId}`;
}

function attachmentIndexKey(ownerPubky: string): string {
  return `${ATTACHMENT_INDEX_PREFIX}${ownerPubky}`;
}

async function readAttachmentServiceIndex(ownerPubky: string): Promise<string[]> {
  try {
    const raw = await getMetadata(attachmentIndexKey(ownerPubky));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

async function writeAttachmentServiceIndex(
  ownerPubky: string,
  services: readonly string[],
): Promise<void> {
  await setMetadata(
    attachmentIndexKey(ownerPubky),
    JSON.stringify([...new Set(services)]),
  );
}

async function rememberAttachmentService(
  ownerPubky: string,
  service: string,
): Promise<void> {
  const current = await readAttachmentServiceIndex(ownerPubky);
  if (current.includes(service)) return;
  await writeAttachmentServiceIndex(ownerPubky, [...current, service]);
}

async function forgetAttachmentService(
  ownerPubky: string,
  service: string,
): Promise<void> {
  await writeAttachmentServiceIndex(
    ownerPubky,
    (await readAttachmentServiceIndex(ownerPubky)).filter(
      (item) => item !== service,
    ),
  );
}

export async function setAttachmentSecret(
  ownerPubky: string,
  senderPubky: string,
  eventId: string,
  material: AttachmentSecretMaterial,
): Promise<void> {
  const service = attachmentKeyService(ownerPubky, senderPubky, eventId);
  const plaintext = new TextEncoder().encode(JSON.stringify(material));
  await wrapSecret(PURPOSE_ATTACHMENT, service, plaintext);
  await rememberAttachmentService(ownerPubky, service);
}

export async function getAttachmentSecret(
  ownerPubky: string,
  senderPubky: string,
  eventId: string,
): Promise<AttachmentSecretMaterial | null> {
  try {
    const plaintext = await unwrapSecret(
      PURPOSE_ATTACHMENT,
      attachmentKeyService(ownerPubky, senderPubky, eventId),
    );
    if (!plaintext) return null;
    return JSON.parse(
      new TextDecoder().decode(plaintext),
    ) as AttachmentSecretMaterial;
  } catch {
    return null;
  }
}

export async function deleteAttachmentSecretByService(
  ownerPubky: string,
  service: string,
): Promise<boolean> {
  try {
    await deleteSecret(PURPOSE_ATTACHMENT, service);
    await forgetAttachmentService(ownerPubky, service);
    return true;
  } catch {
    return false;
  }
}

export async function deleteAttachmentSecret(
  ownerPubky: string,
  senderPubky: string,
  eventId: string,
): Promise<boolean> {
  return deleteAttachmentSecretByService(
    ownerPubky,
    attachmentKeyService(ownerPubky, senderPubky, eventId),
  );
}

export async function deleteAttachmentSecrets(
  ownerPubky: string,
  refs: readonly AttachmentSecretRef[],
): Promise<string[]> {
  const failed: string[] = [];
  for (const ref of refs) {
    const service = attachmentKeyService(ownerPubky, ref.senderPubky, ref.eventId);
    const ok = await deleteAttachmentSecretByService(ownerPubky, service);
    if (!ok) failed.push(service);
  }
  return failed;
}

export async function clearAttachmentSecretsForOwner(
  ownerPubky: string,
): Promise<string[]> {
  const services = await readAttachmentServiceIndex(ownerPubky);
  const failed: string[] = [];
  for (const service of services) {
    const ok = await deleteAttachmentSecretByService(ownerPubky, service);
    if (!ok) failed.push(service);
  }
  if (failed.length === 0) {
    await deleteMetadata(attachmentIndexKey(ownerPubky));
  }
  return failed;
}

// ─── Session / cert validity ──────────────────────────────────────────────────

export async function hasPersistedSession(): Promise<boolean> {
  const pubky = await getPubky();
  return pubky !== null && pubky.length > 0;
}

// ─── Clear all ────────────────────────────────────────────────────────────────

export async function clear(): Promise<void> {
  const db = ensureInitialized();
  const owner = await getMetadata(KEY_PUBKY);
  if (owner) {
    await clearAttachmentSecretsForOwner(owner);
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_SECRETS, STORE_METADATA], "readwrite");
    const secretsStore = tx.objectStore(STORE_SECRETS);
    const metaStore = tx.objectStore(STORE_METADATA);
    const clearSecrets = secretsStore.clear();
    const clearMeta = metaStore.clear();
    let completed = 0;
    const checkComplete = () => {
      completed += 1;
      if (completed === 2) resolve();
    };
    clearSecrets.onsuccess = checkComplete;
    clearMeta.onsuccess = checkComplete;
    clearSecrets.onerror = () =>
      reject(clearSecrets.error ?? new Error("KeyStore: failed to clear secrets"));
    clearMeta.onerror = () =>
      reject(clearMeta.error ?? new Error("KeyStore: failed to clear metadata"));
    tx.onerror = () => reject(tx.error ?? new Error("KeyStore: clear transaction failed"));
  });
  const { setTabLockOwner } = await import("@/services/tabLock");
  setTabLockOwner(null);
}

// ─── Exported object (method names match mobile KeyStore) ─────────────────────

export const KeyStore = {
  initKeyStore,
  wipeLegacyRingMaterial,
  setSessionExport,
  getSessionExport,
  deleteSessionExport,
  setLinkSession,
  getLinkSession,
  deleteLinkSession,
  setReceiverNoiseSecret,
  getReceiverNoiseSecret,
  deleteReceiverNoiseSecret,
  wrapLinkSnapshot,
  unwrapLinkSnapshot,
  deleteLinkSnapshot,
  isWrappedLinkSnapshot,
  setAttachmentSecret,
  getAttachmentSecret,
  deleteAttachmentSecret,
  deleteAttachmentSecretByService,
  deleteAttachmentSecrets,
  clearAttachmentSecretsForOwner,
  attachmentKeyService,
  setPubky,
  getPubky,
  clearPubkyIfMatches,
  setHomeserver,
  getHomeserver,
  // Session
  hasPersistedSession,
  clear,
};
