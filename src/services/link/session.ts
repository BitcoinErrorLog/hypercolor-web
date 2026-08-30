import {
  capabilitiesCoverHypercolorRw,
  extractCapabilitySpecsFromExport,
} from "@/lib/capabilities";
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
};

export type SessionRestoreResult =
  | { status: "live"; pubky: string; handle: SessionHandle }
  | { status: "needs-enable" }
  | { status: "session-offline"; pubky: string };

export type EnableStatus = "needs-enable" | "session-offline" | "enabled";

type LiveSession = { pubky: string; handle: SessionHandle };

let live: LiveSession | null = null;
let restoreInFlight: Promise<SessionRestoreResult> | null = null;
let sessionDb: IDBDatabase | null = null;

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
  const db = await openSessionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(meta, KEY_CURRENT);
    req.onsuccess = () => resolve();
    req.onerror = () =>
      reject(req.error ?? new Error("session: failed to persist metadata"));
  });
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
      resolve(value);
    };
  });
}

export async function wipeSessionMetadata(): Promise<void> {
  const db = await openSessionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(KEY_CURRENT);
    req.onsuccess = () => resolve();
    req.onerror = () =>
      reject(req.error ?? new Error("session: failed to wipe metadata"));
  });
}

export function getLiveSession(): LiveSession | null {
  return live;
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
  live = { pubky, handle };
  await KeyStore.setPubky(pubky);
  return live;
}

export function classifyResumeError(error: unknown): "auth-revoked" | "session-offline" {
  return AUTH_REVOKED_NAMES.has(errorName(error))
    ? "auth-revoked"
    : "session-offline";
}

export function sessionExportCoversHypercolor(exported: string): boolean {
  return capabilitiesCoverHypercolorRw(extractCapabilitySpecsFromExport(exported));
}

export async function adoptApprovedSession(handle: SessionHandle): Promise<LiveSession> {
  const pubky = handle.pubky();
  const exported = handle.exportSession();
  if (!sessionExportCoversHypercolor(exported)) {
    try {
      await PaykitLinkWeb.signOutSession(handle);
    } catch {
      closeHandleQuietly(handle);
    }
    throw Object.assign(new Error("session grant does not cover /pub/hypercolor.app/v1/ rw"), {
      name: "SessionResumeScopeMissing",
    });
  }
  if (live && live.handle !== handle) {
    closeHandleQuietly(live.handle);
  }
  live = { pubky, handle };
  await persistSessionMetadata({ pubky, exported });
  await KeyStore.setPubky(pubky);
  useAuthStore.getState().setAuthenticated(pubky, useAuthStore.getState().homeserver ?? "");
  return live;
}

async function restoreFromPersisted(): Promise<SessionRestoreResult> {
  const stored = await readSessionMetadata();
  if (!stored) return { status: "needs-enable" };

  try {
    const handle = await PaykitLinkWeb.resumeSessionFromCookie(stored.pubky);
    const pubky = handle.pubky();
    if (pubky !== stored.pubky) {
      closeHandleQuietly(handle);
      await wipeSessionMetadata();
      live = null;
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
      live = null;
      return { status: "needs-enable" };
    }
    live = { pubky, handle };
    await persistSessionMetadata({ pubky, exported });
    await KeyStore.setPubky(pubky);
    return { status: "live", pubky, handle };
  } catch (error) {
    if (classifyResumeError(error) === "auth-revoked") {
      await wipeSessionMetadata();
      live = null;
      return { status: "needs-enable" };
    }
    return { status: "session-offline", pubky: stored.pubky };
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
  try {
    await StorageService.retryPendingCleanup();
  } catch {
    // Best-effort journal.
  }
  const restore = await restoreSessionOnLoad();
  if (restore.status === "session-offline") return "session-offline";
  if (restore.status !== "live") return "needs-enable";
  const receiver = await StorageService.getLinkReceiver(restore.pubky);
  if (!receiver?.markerPublished) return "needs-enable";
  return "enabled";
}

/**
 * Sign-out teardown (design §1d): marker + homeserver sign-out, KeyStore
 * wipe, account-scoped SQL, persisted session metadata.
 */
export async function signOut(): Promise<void> {
  const owner =
    live?.pubky ??
    (await readSessionMetadata())?.pubky ??
    (await KeyStore.getPubky());
  let markerPath = LINK_RECEIVER_PATH;
  if (owner) {
    try {
      const receiver = await StorageService.getLinkReceiver(owner);
      if (receiver) markerPath = coerceReceiverPath(receiver.receiverPath);
    } catch {
      // SQL may be unavailable in a readonly tab.
    }
  }
  if (live) {
    try {
      await PaykitLinkWeb.removeReceiverMarker(live.handle, markerPath);
    } catch {
      // Best-effort: peers should stop handshaking into a dead inbox.
    }
    try {
      await PaykitLinkWeb.signOutSession(live.handle);
    } catch {
      closeHandleQuietly(live.handle);
    }
  }
  live = null;
  if (owner) {
    try {
      await StorageService.clearAccountData(owner);
    } catch {
      // Best-effort local wipe.
    }
  }
  try {
    await KeyStore.clear();
  } catch {
    // KeyStore may not be initialized in some tests.
  }
  await wipeSessionMetadata();
  useAuthStore.getState().clearSession();
}

export function resetSessionStateForTests(): void {
  closeHandleQuietly(live?.handle);
  live = null;
  restoreInFlight = null;
  sessionDb = null;
}
