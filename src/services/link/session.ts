import {
  capabilitiesCoverRingGrant,
  extractCapabilitySpecsFromExport,
} from "@/lib/capabilities";
import { zeroizeBytes } from "@/lib/hex";
import { resetPaykitConnectLive } from "@/services/paykitConnectLive";
import { KeyStore } from "@/services/KeyStore";
import { StorageService } from "@/services/StorageService";
import { useAuthStore } from "@/stores/authStore";
import { LINK_RECEIVER_PATH, coerceReceiverPath } from "@/types/link";
import { PaykitLinkWeb, type SessionHandle } from "./PaykitLinkWeb";

const DB_NAME = "hypercolor-session";
const DB_VERSION = 1;
const STORE = "metadata";
const KEY_CURRENT = "current";

const AUTH_REVOKED_NAMES = new Set([
  "SessionResumeUnauthorized",
  "SessionResumePubkyMismatch",
  "SessionResumeScopeMissing",
]);

export type PersistedSession = {
  pubky: string;
  exported: string;
  /** Receiver path published after Enable. Evidence, not a boolean flag. */
  receiverPath?: string;
};

export type SessionRestoreResult =
  | { status: "live"; pubky: string; handle: SessionHandle }
  | { status: "needs-enable" }
  | { status: "session-offline"; pubky: string };

export type EnableStatus = "needs-enable" | "session-offline" | "enabled";

type LiveSession = { pubky: string; handle: SessionHandle };

const LIVE_KEY = "__hypercolorLiveSession";
type LiveGlobal = typeof globalThis & { [LIVE_KEY]?: LiveSession | null };

let live: LiveSession | null = (globalThis as LiveGlobal)[LIVE_KEY] ?? null;

function bindLive(next: LiveSession | null): LiveSession | null {
  live = next;
  (globalThis as LiveGlobal)[LIVE_KEY] = next;
  return next;
}

let restoreInFlight: Promise<SessionRestoreResult> | null = null;
let sessionDb: IDBDatabase | null = null;
let writeEpoch = 0;

function bumpWriteEpoch(): number {
  writeEpoch += 1;
  return writeEpoch;
}

const COOKIE_RESUME_BUDGET_MS = 4_000;
const EXPORT_RESTORE_BUDGET_MS = 8_000;

async function withBudget<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            Object.assign(new Error(`${label} timed out after ${ms}ms`), {
              name: "SessionResumeTimeout",
            }),
          );
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

function closeHandleQuietly(handle: SessionHandle | null | undefined): void {
  if (!handle) return;
  try {
    handle.free();
  } catch {
    // Handle may already be consumed (sign-out).
  }
}

async function openSessionDb(): Promise<IDBDatabase> {
  if (sessionDb) return sessionDb;
  sessionDb = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () =>
      reject(req.error ?? new Error("session: failed to open IndexedDB"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
  return sessionDb;
}

export async function persistSessionMetadata(
  meta: PersistedSession,
): Promise<void> {
  const epoch = writeEpoch;
  const db = await openSessionDb();
  if (epoch !== writeEpoch) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("session: persist metadata aborted"));
    tx.onerror = () =>
      reject(tx.error ?? new Error("session: failed to persist metadata"));
    tx.objectStore(STORE).put(meta, KEY_CURRENT);
  });
  if (epoch !== writeEpoch) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error ?? new Error("session: roll back metadata aborted"));
      tx.onerror = () =>
        reject(tx.error ?? new Error("session: failed to roll back metadata"));
      tx.objectStore(STORE).delete(KEY_CURRENT);
    });
  }
}

export async function readSessionMetadata(): Promise<PersistedSession | null> {
  const db = await openSessionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY_CURRENT);
    req.onerror = () =>
      reject(req.error ?? new Error("session: failed to read metadata"));
    req.onsuccess = () => {
      const value = req.result as PersistedSession | undefined;
      if (
        !value ||
        typeof value.pubky !== "string" ||
        typeof value.exported !== "string" ||
        value.pubky.length === 0 ||
        value.exported.length === 0
      ) {
        resolve(null);
        return;
      }
      const receiverPath =
        typeof value.receiverPath === "string" && value.receiverPath.length > 0
          ? value.receiverPath
          : undefined;
      resolve(
        receiverPath
          ? { pubky: value.pubky, exported: value.exported, receiverPath }
          : { pubky: value.pubky, exported: value.exported },
      );
    };
  });
}

export async function wipeSessionMetadata(): Promise<void> {
  bumpWriteEpoch();
  const db = await openSessionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("session: wipe metadata aborted"));
    tx.onerror = () =>
      reject(tx.error ?? new Error("session: failed to wipe metadata"));
    tx.objectStore(STORE).delete(KEY_CURRENT);
  });
}

export function getLiveSession(): LiveSession | null {
  return live;
}

export async function persistReceiverPath(
  pubky: string,
  receiverPath: string,
): Promise<void> {
  const epoch = writeEpoch;
  const stored = await readSessionMetadata();
  if (epoch !== writeEpoch) return;
  if (stored) {
    if (stored.pubky !== pubky) return;
    await persistSessionMetadata({ ...stored, receiverPath });
    return;
  }
  const current = getLiveSession();
  if (!current || current.pubky !== pubky) return;
  let exported: string;
  try {
    exported = current.handle.exportSession();
  } catch {
    return;
  }
  if (!sessionExportCoversHypercolor(exported)) return;
  await persistSessionMetadata({ pubky, exported, receiverPath });
}

async function metadataWithPreservedReceiver(
  pubky: string,
  exported: string,
  previous: PersistedSession | null,
): Promise<PersistedSession> {
  const receiverPath =
    previous?.pubky === pubky ? previous.receiverPath : undefined;
  return receiverPath
    ? { pubky, exported, receiverPath }
    : { pubky, exported };
}

async function hasDurableEnableEvidence(
  pubky: string | null | undefined,
  stored: PersistedSession | null,
): Promise<boolean> {
  if (!pubky) return false;
  const owner = await KeyStore.getPubky();
  if (!owner || owner !== pubky) return false;
  const alias =
    stored?.pubky === pubky && stored.receiverPath
      ? stored.receiverPath
      : LINK_RECEIVER_PATH;
  let secret: Uint8Array | null = null;
  try {
    secret = await KeyStore.getReceiverNoiseSecret(alias);
  } catch {
    return false;
  }
  if (!secret) return false;
  zeroizeBytes(secret);
  return true;
}

/**
 * Harness / secret-signin: adopt a live SessionHandle without the
 * hypercolor-capability gate used by {@link adoptApprovedSession}.
 */
export async function adoptLiveHandle(handle: SessionHandle): Promise<LiveSession> {
  const pubky = handle.pubky();
  if (live && live.handle !== handle) {
    closeHandleQuietly(live.handle);
  }
  const adopted = bindLive({ pubky, handle })!;
  await KeyStore.setPubky(pubky);
  return adopted;
}

export function classifyResumeError(error: unknown): "auth-revoked" | "session-offline" {
  return AUTH_REVOKED_NAMES.has(errorName(error))
    ? "auth-revoked"
    : "session-offline";
}

export function sessionExportCoversHypercolor(exported: string): boolean {
  return capabilitiesCoverRingGrant(extractCapabilitySpecsFromExport(exported));
}

export async function adoptApprovedSession(handle: SessionHandle): Promise<LiveSession> {
  const {
    acquireScopedWriter,
    assertWriter,
    exitWriterCriticalSection,
    hasWriterLock,
    isWriterCriticalSectionHeld,
    setTabLockOwner,
  } = await import("@/services/tabLock");
  const pubky = handle.pubky();
  await acquireScopedWriter(pubky);
  let keyStoreAdvanced = false;
  let adoptionCommitted = false;
  try {
    assertWriter("adoptApprovedSession:start");
    const exported = handle.exportSession();
    if (!sessionExportCoversHypercolor(exported)) {
      try {
        await PaykitLinkWeb.signOutSession(handle);
      } catch {
        closeHandleQuietly(handle);
      }
      throw Object.assign(
        new Error("session grant does not cover the Ring grant /pub/paykit/:rw and /pub/hypercolor.app/v1/:rw"),
        {
          name: "SessionResumeScopeMissing",
        },
      );
    }
    assertWriter("adoptApprovedSession:after-export");
    if (live && live.handle !== handle) {
      closeHandleQuietly(live.handle);
    }
    const adopted = bindLive({ pubky, handle })!;
    const previous = await readSessionMetadata();
    assertWriter("adoptApprovedSession:after-read-metadata");
    await persistSessionMetadata(
      await metadataWithPreservedReceiver(pubky, exported, previous),
    );
    assertWriter("adoptApprovedSession:after-sqlite");
    await KeyStore.setPubky(pubky);
    keyStoreAdvanced = true;
    assertWriter("adoptApprovedSession:after-keystore");
    useAuthStore.getState().setAuthenticated(pubky, useAuthStore.getState().homeserver ?? "");
    adoptionCommitted = true;
    return adopted;
  } catch (err) {
    if (keyStoreAdvanced && !adoptionCommitted && !hasWriterLock()) {
      try {
        await KeyStore.clearPubkyIfMatches(pubky);
      } catch {
        /* rollback best-effort */
      }
    }
    throw err;
  } finally {
    exitWriterCriticalSection();
    if (keyStoreAdvanced && !adoptionCommitted) {
      const still = await KeyStore.getPubky();
      if (still !== pubky && !isWriterCriticalSectionHeld()) {
        try {
          setTabLockOwner(null);
        } catch {
          /* scope reset best-effort after the section */
        }
      }
    }
  }
}

async function adoptRestoredHandle(
  handle: SessionHandle,
  stored: PersistedSession,
): Promise<SessionRestoreResult> {
  const epoch = writeEpoch;
  const pubky = handle.pubky();
  if (pubky !== stored.pubky) {
    closeHandleQuietly(handle);
    await wipeSessionMetadata();
    bindLive(null);
    return { status: "needs-enable" };
  }
  const exported = handle.exportSession();
  if (!sessionExportCoversHypercolor(exported)) {
    try {
      await PaykitLinkWeb.signOutSession(handle);
    } catch {
      closeHandleQuietly(handle);
    }
    await wipeSessionMetadata();
    bindLive(null);
    return { status: "needs-enable" };
  }
  if (epoch !== writeEpoch) {
    closeHandleQuietly(handle);
    return { status: "needs-enable" };
  }
  bindLive({ pubky, handle });
  await persistSessionMetadata(
    await metadataWithPreservedReceiver(pubky, exported, stored),
  );
  if (epoch !== writeEpoch) {
    if (live?.handle === handle) bindLive(null);
    closeHandleQuietly(handle);
    return { status: "needs-enable" };
  }
  await KeyStore.setPubky(pubky);
  if (epoch !== writeEpoch) {
    if (live?.handle === handle) bindLive(null);
    return { status: "needs-enable" };
  }
  return { status: "live", pubky, handle };
}

async function restoreFromPersisted(): Promise<SessionRestoreResult> {
  const stored = await readSessionMetadata();
  if (!stored) return { status: "needs-enable" };

  try {
    const handle = await withBudget(
      PaykitLinkWeb.resumeSessionFromCookie(stored.pubky),
      COOKIE_RESUME_BUDGET_MS,
      "cookie resume",
    );
    return await adoptRestoredHandle(handle, stored);
  } catch (error) {
    if (classifyResumeError(error) === "auth-revoked") {
      if (await hasDurableEnableEvidence(stored.pubky, stored)) {
        return { status: "session-offline", pubky: stored.pubky };
      }
      await wipeSessionMetadata();
      bindLive(null);
      return { status: "needs-enable" };
    }
    try {
      const handle = await withBudget(
        PaykitLinkWeb.restoreSession(stored.exported),
        EXPORT_RESTORE_BUDGET_MS,
        "export restore",
      );
      return await adoptRestoredHandle(handle, stored);
    } catch (exportError) {
      if (classifyResumeError(exportError) === "auth-revoked") {
        if (await hasDurableEnableEvidence(stored.pubky, stored)) {
          return { status: "session-offline", pubky: stored.pubky };
        }
        await wipeSessionMetadata();
        bindLive(null);
        return { status: "needs-enable" };
      }
      return { status: "session-offline", pubky: stored.pubky };
    }
  }
}

/**
 * Silent restore on load. Concurrent callers share one in-flight restore
 * (mp-dm messaging restore pattern).
 */
export async function restoreSessionOnLoad(): Promise<SessionRestoreResult> {
  if (live) {
    return { status: "live", pubky: live.pubky, handle: live.handle };
  }
  restoreInFlight ??= restoreFromPersisted();
  try {
    return await restoreInFlight;
  } finally {
    restoreInFlight = null;
  }
}

export async function getEnableStatus(): Promise<EnableStatus> {
  // Never await the journal here. Cleanup opens SQLite (OPFS SAH). After a
  // document navigation that pool can stay locked while the previous
  // document's handles drain — blocking this call keeps the Enable CTA up
  // even when cookie resume and receiver keys already succeeded.
  void StorageService.retryPendingCleanup().catch(() => {
    // Best-effort journal.
  });
  const restore = await restoreSessionOnLoad();
  const stored = await readSessionMetadata();
  const pubky =
    restore.status === "live" || restore.status === "session-offline"
      ? restore.pubky
      : stored?.pubky;
  let durable = false;
  try {
    durable = await hasDurableEnableEvidence(pubky, stored);
  } catch {
    durable = false;
  }
  if (restore.status === "session-offline") {
    return durable ? "session-offline" : "needs-enable";
  }
  if (restore.status !== "live") return "needs-enable";
  return durable ? "enabled" : "needs-enable";
}

/**
 * Sign-out teardown (design §1d): marker + homeserver sign-out, KeyStore
 * wipe, account-scoped SQL, persisted session metadata.
 */
export async function signOut(): Promise<void> {
  bumpWriteEpoch();
  const previous = live;
  bindLive(null);
  const owner =
    previous?.pubky ??
    (await readSessionMetadata())?.pubky ??
    (await KeyStore.getPubky());
  let markerPath = LINK_RECEIVER_PATH;
  let receiverAlias = LINK_RECEIVER_PATH;
  if (owner) {
    try {
      const receiver = await StorageService.getLinkReceiver(owner);
      if (receiver) {
        markerPath = coerceReceiverPath(receiver.receiverPath);
        receiverAlias = receiver.receiverAlias;
      }
    } catch {
      // SQL may be unavailable in a readonly tab.
    }
  }
  const handle = previous?.handle;
  if (handle && owner) {
    try {
      const secret = await KeyStore.getReceiverNoiseSecret(receiverAlias);
      let localPk: string | null = null;
      if (secret) {
        try {
          localPk = await PaykitLinkWeb.noisePublicKeyFromSecret(secret);
        } finally {
          zeroizeBytes(secret);
        }
      }
      // Matching published pk → this device owns the inbox: delete the marker.
      // GET throw / failure: do not delete. An active receiver whose GET fails
      // must not wipe a live marker (offline ≠ absent). Standby is unchanged:
      // a foreign pk is not ours, so we never delete it.
      //
      // Orphan markers exist when a session published receiver.json then signed
      // out while standby siblings never published. The published pk belongs to
      // a signed-out session. Recovery is takeover (PUT this device's current
      // receiver pk), not deleting blindly on GET failure.
      if (localPk) {
        const marker = await PaykitLinkWeb.getReceiverMarker(owner, markerPath);
        if (marker && marker.noisePublicKey === localPk) {
          await PaykitLinkWeb.removeReceiverMarker(handle, markerPath);
        }
      }
    } catch {
      // Best-effort: never delete a marker we did not confirm as ours.
    }
  }
  if (handle) {
    try {
      await PaykitLinkWeb.signOutSession(handle);
    } catch {
      closeHandleQuietly(handle);
    }
  }
  if (owner) {
    try {
      await StorageService.clearAccountData(owner);
    } catch {
      // Best-effort local wipe.
    }
  }
  resetPaykitConnectLive();
  try {
    await KeyStore.clear();
  } catch {
    // KeyStore may not be initialized in some tests.
  }
  await wipeSessionMetadata();
  useAuthStore.getState().clearSession();
}

export function resetSessionStateForTests(): void {
  bumpWriteEpoch();
  closeHandleQuietly(live?.handle);
  bindLive(null);
  restoreInFlight = null;
  sessionDb = null;
}
