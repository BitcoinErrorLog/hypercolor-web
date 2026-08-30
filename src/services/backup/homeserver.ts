import {
  createLinkNativeError,
  isLinkNativeError,
  PaykitLinkWeb,
  toLinkNativeError,
} from "../link/PaykitLinkWeb";
import { getLiveSession } from "../link/session";
import type { BackupTransport } from "./BackupService";
import { backupLatestUrl } from "./crypto";

const BACKUP_PATH = "/pub/hypercolor.app/v1/backup/latest";

export type BackupHomeserverTarget = {
  ownerPubky: string;
  path: typeof BACKUP_PATH;
};

export function parseBackupHomeserverUrl(url: string): BackupHomeserverTarget {
  const match = /^pubky:\/\/([^/]+)(\/pub\/hypercolor\.app\/v1\/backup\/latest)$/.exec(
    url,
  );
  if (!match?.[1] || match[2] !== BACKUP_PATH) {
    throw new Error("BackupService: backup url is not the owner latest path");
  }
  return { ownerPubky: match[1], path: BACKUP_PATH };
}

function isAbsentBackupError(err: unknown, mappedMessage: string): boolean {
  const raw = err instanceof Error ? err.message : mappedMessage;
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String((err as { name?: unknown }).name ?? "")
      : "";
  return /\b404\b|not[- ]found/i.test(`${name} ${raw} ${mappedMessage}`);
}

function mapPutError(err: unknown): Error {
  if (err instanceof Error && err.message.startsWith("BackupService:")) {
    return err;
  }
  const mapped = isLinkNativeError(err) ? err : toLinkNativeError(err);
  if (mapped.code === "auth" || mapped.code === "unavailable") {
    return new Error(
      "BackupService: no owner session. Sign in before exporting a backup.",
    );
  }
  return new Error(`BackupService: ${mapped.message}`);
}

/**
 * Real homeserver transport for {@link BackupTransport}.
 * `putOwner` requires a live owner session. `getPublic` is a wasm public GET
 * and does not need a session (404 → `null`).
 */
export function createHomeserverBackupTransport(): BackupTransport {
  return {
    async putOwner(url, content) {
      const target = parseBackupHomeserverUrl(url);
      const live = getLiveSession();
      if (!live) {
        throw mapPutError(
          createLinkNativeError(
            "auth",
            "Enable encrypted messaging to write to your homeserver.",
          ),
        );
      }
      if (live.pubky !== target.ownerPubky) {
        throw new Error("Backup belongs to a different account");
      }
      if (url !== backupLatestUrl(live.pubky)) {
        throw new Error("BackupService: backup url is not the owner latest path");
      }
      try {
        await PaykitLinkWeb.putPublic(
          live.handle,
          target.path,
          new TextEncoder().encode(content),
        );
      } catch (err) {
        throw mapPutError(err);
      }
    },

    async getPublic(url) {
      const target = parseBackupHomeserverUrl(url);
      let raw: Uint8Array | undefined;
      try {
        raw = await PaykitLinkWeb.publicGet(target.ownerPubky, target.path);
      } catch (err) {
        const mapped = isLinkNativeError(err) ? err : toLinkNativeError(err);
        if (mapped.code === "network") {
          throw new Error("BackupService: network error");
        }
        if (isAbsentBackupError(err, mapped.message)) {
          return null;
        }
        throw new Error(`BackupService: ${mapped.message}`);
      }
      if (raw === undefined) return null;
      const text = new TextDecoder().decode(raw);
      return text.length > 0 ? text : null;
    },
  };
}
