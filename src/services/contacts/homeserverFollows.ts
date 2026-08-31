import { parsePubky } from "@/utils/pubkyId";
import type { PubkyKey } from "@/types";

/** World-readable pubky.app follow documents. Read-only — never PUT. */
export const PUBKY_APP_FOLLOWS_DIR = "/pub/pubky.app/follows/";

export function followDocumentPath(peerPubky: PubkyKey): string {
  return `${PUBKY_APP_FOLLOWS_DIR}${peerPubky}`;
}

export type HomeserverFollowsIo = {
  publicGet(ownerPubky: PubkyKey, path: string): Promise<Uint8Array | undefined>;
};

export type HomeserverFollowsList =
  | { ok: true; pubkys: PubkyKey[] }
  | { ok: false; kind: "network" | "decode"; message: string };

export type FollowDocument = { createdAt: number };

const decoder = new TextDecoder();

export function parseFollowsDirectoryListing(raw: string): PubkyKey[] | null {
  const text = raw.trim();
  if (text.length === 0) return [];
  if (text.startsWith("{") || text.startsWith("[")) return null;
  const out: PubkyKey[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const peer = peerFromListingLine(line);
    if (!peer || seen.has(peer)) continue;
    seen.add(peer);
    out.push(peer);
  }
  return out;
}

function peerFromListingLine(line: string): PubkyKey | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const withoutScheme = trimmed.startsWith("pubky://") ? trimmed.slice("pubky://".length) : trimmed;
  const pathStart = withoutScheme.indexOf("/");
  const path = pathStart === -1 ? withoutScheme : withoutScheme.slice(pathStart);
  if (!path.includes("/pub/pubky.app/follows/")) {
    const last = withoutScheme.split("/").filter(Boolean).at(-1);
    return last ? parsePubky(last) : null;
  }
  const after = path.split("/pub/pubky.app/follows/")[1] ?? "";
  const segment = after.split("/").filter(Boolean)[0] ?? "";
  return parsePubky(segment);
}

export function parseFollowDocument(raw: string): FollowDocument | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const createdAt = (body as { created_at?: unknown }).created_at;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  return { createdAt };
}

export function createHomeserverFollows(io: HomeserverFollowsIo) {
  return {
    async listOwnFollows(ownerPubky: PubkyKey): Promise<HomeserverFollowsList> {
      let bytes: Uint8Array | undefined;
      try {
        bytes = await io.publicGet(ownerPubky, PUBKY_APP_FOLLOWS_DIR);
      } catch (err) {
        return {
          ok: false,
          kind: "network",
          message: err instanceof Error ? err.message : String(err),
        };
      }
      if (bytes === undefined) return { ok: true, pubkys: [] };
      const parsed = parseFollowsDirectoryListing(decoder.decode(bytes));
      if (parsed === null) {
        return { ok: false, kind: "decode", message: "Follows directory was not a listing" };
      }
      return { ok: true, pubkys: parsed.filter((peer) => peer !== ownerPubky) };
    },

    async confirmFollow(ownerPubky: PubkyKey, peerPubky: PubkyKey): Promise<boolean> {
      if (peerPubky === ownerPubky) return false;
      let bytes: Uint8Array | undefined;
      try {
        bytes = await io.publicGet(ownerPubky, followDocumentPath(peerPubky));
      } catch {
        return false;
      }
      if (bytes === undefined) return false;
      return parseFollowDocument(decoder.decode(bytes)) !== null;
    },
  };
}

export function defaultHomeserverFollowsIo(): HomeserverFollowsIo {
  return {
    async publicGet(ownerPubky, path) {
      const { PaykitLinkWeb } = await import("@/services/link/PaykitLinkWeb");
      return PaykitLinkWeb.publicGet(ownerPubky, path);
    },
  };
}
