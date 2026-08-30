/**
 * File helpers for attachment plaintext. Encoding matches mobile
 * (`toBase64Url` / `fromBase64Url` / `decodedBase64Bytes`).
 *
 * Browser: OPFS via `navigator.storage.getDirectory()`.
 * Node (vitest): temp-dir fallback so tests run without OPFS.
 */

const ATTACHMENT_DIR = "hypercolor-attachments";
const OPFS_PREFIX = "opfs://";

export function toBase64Url(standardB64: string): string {
  return standardB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(urlB64: string): string {
  const std = urlB64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = std.length % 4 === 0 ? "" : "=".repeat(4 - (std.length % 4));
  return std + pad;
}

export function decodedBase64Bytes(standardOrUrlB64: string): number {
  const std = fromBase64Url(
    standardOrUrlB64.includes("+") || standardOrUrlB64.includes("/")
      ? toBase64Url(standardOrUrlB64)
      : standardOrUrlB64,
  );
  const pad = (std.match(/=+$/) ?? [""])[0].length;
  return Math.floor((std.length * 3) / 4) - pad;
}

function usesOpfs(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function"
  );
}

function usesNodeFs(): boolean {
  return (
    !usesOpfs() &&
    typeof process !== "undefined" &&
    process.versions?.node != null
  );
}

function nodeCacheRoot(): string {
  const tmp =
    process.env.HYPERCOLOR_ATTACHMENT_CACHE ??
    process.env.TMPDIR ??
    process.env.TMP ??
    process.env.TEMP ??
    "/tmp";
  const sep = tmp.includes("\\") ? "\\" : "/";
  const root = tmp.endsWith("/") || tmp.endsWith("\\") ? tmp : `${tmp}${sep}`;
  return `${root}${ATTACHMENT_DIR}${sep}`;
}

function cacheRoot(): string {
  if (usesOpfs()) return `${OPFS_PREFIX}${ATTACHMENT_DIR}/`;
  if (usesNodeFs()) return nodeCacheRoot();
  throw new Error("Attachment file IO needs OPFS or Node fs");
}

function pathSep(): string {
  const root = cacheRoot();
  return root.includes("\\") && !root.startsWith(OPFS_PREFIX) ? "\\" : "/";
}

export function attachmentCacheDirectory(ownerPubky: string): string {
  const root = cacheRoot();
  const sep = pathSep();
  const prefix = root.endsWith("/") || root.endsWith("\\") ? root : `${root}${sep}`;
  return `${prefix}${ownerPubky}${sep}`;
}

export function attachmentCachePath(
  ownerPubky: string,
  senderPubky: string,
  eventId: string,
): string {
  return `${attachmentCacheDirectory(ownerPubky)}${senderPubky}${pathSep()}${eventId}`;
}

export function attachmentThumbCachePath(
  ownerPubky: string,
  senderPubky: string,
  eventId: string,
): string {
  return `${attachmentCachePath(ownerPubky, senderPubky, eventId)}.thumb`;
}

export function cachePathsForAttachment(row: {
  ownerPubky: string;
  senderPubky: string;
  eventId: string;
  localCachePath: string | null;
}): string[] {
  const primary = attachmentCachePath(
    row.ownerPubky,
    row.senderPubky,
    row.eventId,
  );
  const paths = new Set<string>([primary, `${primary}.thumb`]);
  if (row.localCachePath) {
    paths.add(row.localCachePath);
    if (!row.localCachePath.endsWith(".thumb")) {
      paths.add(`${row.localCachePath}.thumb`);
    }
  }
  return [...paths];
}

function standardB64ToBytes(standardB64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(standardB64, "base64"));
  }
  const bin = atob(standardB64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToStandardB64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function splitPath(path: string): string[] {
  const stripped = path.startsWith(OPFS_PREFIX)
    ? path.slice(OPFS_PREFIX.length)
    : path.startsWith(nodeCacheRoot())
      ? path.slice(nodeCacheRoot().length)
      : path;
  return stripped.split(/[/\\]+/).filter((part) => part.length > 0);
}

async function opfsWalk(
  parts: string[],
  create: boolean,
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  if (parts.length === 0) {
    throw new Error("attachment path is empty");
  }
  const name = parts[parts.length - 1]!;
  let dir = await navigator.storage.getDirectory();
  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return { dir, name };
}

async function readOpfs(path: string): Promise<Uint8Array> {
  const { dir, name } = await opfsWalk(splitPath(path), false);
  const handle = await dir.getFileHandle(name);
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function writeOpfs(path: string, bytes: Uint8Array): Promise<void> {
  const { dir, name } = await opfsWalk(splitPath(path), true);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  const chunk = new Uint8Array(bytes.byteLength);
  chunk.set(bytes);
  await writable.write(chunk);
  await writable.close();
}

async function existsOpfs(path: string): Promise<boolean> {
  try {
    const { dir, name } = await opfsWalk(splitPath(path), false);
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function deleteOpfs(path: string): Promise<void> {
  try {
    const { dir, name } = await opfsWalk(splitPath(path), false);
    await dir.removeEntry(name);
  } catch {
    // Best-effort cache wipe.
  }
}

async function nodeFs(): Promise<typeof import("node:fs/promises")> {
  return import("node:fs/promises");
}

async function nodePath(): Promise<typeof import("node:path")> {
  return import("node:path");
}

export async function readFileAsStandardBase64(
  uri: string,
): Promise<{ base64: string; size: number }> {
  let bytes: Uint8Array;
  if (usesOpfs()) {
    try {
      bytes = await readOpfs(uri);
    } catch {
      throw new Error(`attachment file not found: ${uri}`);
    }
  } else if (usesNodeFs()) {
    const fs = await nodeFs();
    try {
      bytes = new Uint8Array(await fs.readFile(uri));
    } catch {
      throw new Error(`attachment file not found: ${uri}`);
    }
  } else {
    throw new Error("Attachment file IO needs OPFS or Node fs");
  }
  const base64 = bytesToStandardB64(bytes);
  return { base64, size: decodedBase64Bytes(base64) };
}

export async function writeFileFromStandardBase64(
  path: string,
  standardB64: string,
): Promise<void> {
  const bytes = standardB64ToBytes(standardB64);
  if (usesOpfs()) {
    await writeOpfs(path, bytes);
    return;
  }
  if (usesNodeFs()) {
    const fs = await nodeFs();
    const pathMod = await nodePath();
    const dir = pathMod.dirname(path);
    if (dir.length > 0) await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path, bytes);
    return;
  }
  throw new Error("Attachment file IO needs OPFS or Node fs");
}

export async function cacheFileExists(path: string): Promise<boolean> {
  if (usesOpfs()) return existsOpfs(path);
  if (usesNodeFs()) {
    const fs = await nodeFs();
    try {
      const stat = await fs.stat(path);
      return stat.isFile();
    } catch {
      return false;
    }
  }
  return false;
}

export async function deleteCacheFiles(
  paths: readonly (string | null | undefined)[],
): Promise<void> {
  for (const path of paths) {
    if (!path) continue;
    try {
      if (usesOpfs()) await deleteOpfs(path);
      else if (usesNodeFs()) {
        const fs = await nodeFs();
        await fs.rm(path, { force: true });
      }
    } catch {
      // Best-effort cache wipe.
    }
  }
}
