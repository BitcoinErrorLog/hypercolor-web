import { DEFAULT_NEXUS_BASE_URL } from "@/flags/config";
import {
  NEXUS_FETCH_INIT,
  parseNexusJson,
  readNexusResponseText,
} from "@/lib/nexus-http";
import { PUBLIC_POST_DISPLAY_MAX_CHARS } from "@/lib/public-text";
import { normalizeTagLabel, parsePostKey } from "@/lib/tag-channel";
import type { NexusFailure, NexusListQuery, NexusResult } from "@/services/NexusClient";
import type { PubkyKey } from "@/types";
import { parsePubky } from "@/utils/pubkyId";

/**
 * Read-only Nexus calls for public discovery (hot tags, posts-by-tag,
 * username search). Nexus is an untrusted accelerator: callers must treat
 * network / decode / empty as slow-or-empty, never as trusted chat state.
 *
 * Never attach viewer_id, observer_id, channel ids, or private-group paths.
 * Do not call these from a private thread or inbox prefetch.
 */

export type NexusHotTag = {
  label: string;
  taggedCount: number;
  taggersCount: number;
};

export type NexusPostByTag = {
  author: PubkyKey;
  postId: string;
  score: number;
};

export type NexusPublicPost = {
  author: PubkyKey;
  postId: string;
  content: string;
  indexedAt: number;
  kind: string;
};

export type NexusDiscoveryApi = {
  hotTags(query?: NexusListQuery): Promise<NexusResult<NexusHotTag[]>>;
  searchPostsByTag(tag: string, query?: NexusListQuery): Promise<NexusResult<NexusPostByTag[]>>;
  post(author: PubkyKey, postId: string): Promise<NexusResult<NexusPublicPost | null>>;
  searchUsersByName(prefix: string, query?: NexusListQuery): Promise<NexusResult<PubkyKey[]>>;
};

export type NexusDiscoveryClientOptions = {
  baseUrl?: string;
  fetchFn?: typeof fetch;
};

export const HOT_TAGS_DEFAULT_LIMIT = 40;
export const POSTS_BY_TAG_DEFAULT_LIMIT = 20;
export const USER_SEARCH_DEFAULT_LIMIT = 8;

function readConfiguredNexusBaseUrl(): string {
  try {
    // Lazy so unit tests that pass an explicit baseUrl never load MMKV.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const flags = require("../../flags") as { AppConfig: { getNexusBaseUrl?: () => string } };
    const fromConfig = flags.AppConfig.getNexusBaseUrl?.();
    if (typeof fromConfig === "string" && fromConfig.trim().length > 0) {
      return fromConfig.trim().replace(/\/+$/, "");
    }
  } catch {
    // compile-time default
  }
  return DEFAULT_NEXUS_BASE_URL;
}

function listQuery(query: NexusListQuery | undefined, fallbackLimit: number): string {
  const skip = query?.skip ?? 0;
  const limit = query?.limit ?? fallbackLimit;
  return `skip=${skip}&limit=${limit}`;
}

export function createNexusDiscoveryClient(
  options: NexusDiscoveryClientOptions = {},
): NexusDiscoveryApi {
  const fetchFn = options.fetchFn ?? fetch;

  function currentBaseUrl(): string {
    return (options.baseUrl ?? readConfiguredNexusBaseUrl()).replace(/\/+$/, "");
  }

  async function getJson<T>(
    path: string,
    parse: (body: unknown) => T | null,
    emptyOn404 = false,
  ): Promise<NexusResult<T>> {
    const url = `${currentBaseUrl()}${path}`;
    let response: Response;
    try {
      response = await fetchFn(url, NEXUS_FETCH_INIT);
    } catch (err) {
      return {
        ok: false,
        kind: "network",
        status: null,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    if (emptyOn404 && response.status === 404) {
      const empty = parse([]);
      if (empty !== null) return { ok: true, value: empty };
      return { ok: true, value: null as T };
    }

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const capped = await readNexusResponseText(response, 1024);
        if (capped.ok && capped.text) detail = capped.text.slice(0, 240);
      } catch {
        // status text is enough
      }
      return {
        ok: false,
        kind: "http",
        status: response.status,
        message: `Nexus ${path} returned ${response.status}: ${detail}`,
      };
    }

    const capped = await readNexusResponseText(response);
    if (!capped.ok) {
      return {
        ok: false,
        kind: "decode",
        status: response.status,
        message: `Nexus ${path} returned a body larger than the allowed limit`,
      };
    }
    const parsed = parseNexusJson(capped.text);
    if (!parsed.ok) {
      return {
        ok: false,
        kind: "decode",
        status: response.status,
        message: "Nexus response was not JSON",
      };
    }
    const body = parsed.value;

    const value = parse(body);
    if (value === null) {
      return {
        ok: false,
        kind: "decode",
        status: response.status,
        message: `Nexus ${path} returned an unexpected JSON shape`,
      };
    }
    return { ok: true, value };
  }

  return {
    hotTags(query) {
      // Global index only. Do not send user_id / reach — that would tell
      // Nexus who is browsing rooms.
      const limit = query?.limit ?? HOT_TAGS_DEFAULT_LIMIT;
      return getJson(`/v0/tags/hot?${listQuery(query, HOT_TAGS_DEFAULT_LIMIT)}`, (body) =>
        parseHotTags(body, limit),
      );
    },
    searchPostsByTag(tag, query) {
      const limit = query?.limit ?? POSTS_BY_TAG_DEFAULT_LIMIT;
      return getJson(
        `/v0/search/posts/by_tag/${encodeURIComponent(tag)}?${listQuery(query, POSTS_BY_TAG_DEFAULT_LIMIT)}`,
        (body) => parsePostsByTag(body, limit),
      );
    },
    post(author, postId) {
      return getJson(
        `/v0/post/${encodeURIComponent(author)}/${encodeURIComponent(postId)}`,
        parsePublicPost,
        true,
      );
    },
    searchUsersByName(prefix, query) {
      const limit = query?.limit ?? USER_SEARCH_DEFAULT_LIMIT;
      return getJson(
        `/v0/search/users/by_name/${encodeURIComponent(prefix)}?${listQuery(query, USER_SEARCH_DEFAULT_LIMIT)}`,
        (body) => parsePubkyList(body, limit),
        true,
      );
    },
  };
}

function clipText(value: string, maxChars: number): string {
  const chars = [...value];
  if (chars.length <= maxChars) return value;
  return chars.slice(0, maxChars).join("");
}

function parseHotTags(body: unknown, maxItems: number): NexusHotTag[] | null {
  if (!Array.isArray(body)) return null;
  const out: NexusHotTag[] = [];
  for (const item of body) {
    if (out.length >= maxItems) break;
    if (typeof item !== "object" || item === null) continue;
    const rec = item as { label?: unknown; tagged_count?: unknown; taggers_count?: unknown };
    if (typeof rec.label !== "string" || rec.label.length === 0) continue;
    const label = normalizeTagLabel(rec.label);
    if (!label) continue;
    const taggedCount = asNonNegativeInt(rec.tagged_count);
    const taggersCount = asNonNegativeInt(rec.taggers_count);
    if (taggedCount === null || taggersCount === null) continue;
    out.push({ label, taggedCount, taggersCount });
  }
  return out;
}

function parsePostsByTag(body: unknown, maxItems: number): NexusPostByTag[] | null {
  if (!Array.isArray(body)) return null;
  const out: NexusPostByTag[] = [];
  for (const item of body) {
    if (out.length >= maxItems) break;
    if (typeof item !== "object" || item === null) continue;
    const rec = item as { post_key?: unknown; score?: unknown };
    const key = parsePostKey(rec.post_key);
    const score = asNonNegativeInt(rec.score) ?? 0;
    if (!key) continue;
    out.push({ author: key.author, postId: key.postId, score });
  }
  return out;
}

function parsePublicPost(body: unknown): NexusPublicPost | null {
  if (body === null || (typeof body === "object" && Array.isArray(body) && body.length === 0)) {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const details = (body as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return null;
  const rec = details as {
    content?: unknown;
    id?: unknown;
    author?: unknown;
    indexed_at?: unknown;
    kind?: unknown;
  };
  if (typeof rec.content !== "string") return null;
  if (typeof rec.id !== "string" || rec.id.length === 0) return null;
  const author = typeof rec.author === "string" ? parsePubky(rec.author) : null;
  if (!author) return null;
  const indexedAt = asNonNegativeInt(rec.indexed_at);
  if (indexedAt === null) return null;
  const kind = typeof rec.kind === "string" && rec.kind.length > 0 ? rec.kind : "short";
  return {
    author,
    postId: rec.id,
    content: clipText(rec.content, PUBLIC_POST_DISPLAY_MAX_CHARS),
    indexedAt,
    kind,
  };
}

function parsePubkyList(body: unknown, maxItems: number): PubkyKey[] | null {
  if (!Array.isArray(body)) return null;
  const out: PubkyKey[] = [];
  for (const item of body) {
    if (out.length >= maxItems) break;
    if (typeof item !== "string") continue;
    const pubky = parsePubky(item);
    if (!pubky) continue;
    out.push(pubky);
  }
  return out;
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return null;
}

export function nexusFailure(
  kind: NexusFailure["kind"],
  status: number | null,
  message: string,
): NexusFailure {
  return { ok: false, kind, status, message };
}

export const NexusDiscoveryClient = createNexusDiscoveryClient();
