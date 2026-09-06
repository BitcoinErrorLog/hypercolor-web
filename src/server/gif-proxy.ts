import { ATTACHMENT_MAX_BYTES } from "@/flags/config";

export type GifMedia = {
  id: string;
  previewUrl: string;
  gifUrl: string;
  width: number;
  height: number;
};

type TenorFormat = { url?: unknown; dims?: unknown };
type TenorResult = { id?: unknown; media_formats?: Record<string, TenorFormat> };

const WINDOW_MS = 60_000;
const SEARCH_LIMIT = 30;
const FETCH_LIMIT = 20;

type Bucket = { at: number; count: number };
const searchHits = new Map<string, Bucket>();
const fetchHits = new Map<string, Bucket>();
const allow = new Map<string, { gifUrl: string; previewUrl: string; expires: number }>();

function take(map: Map<string, Bucket>, key: string, limit: number): boolean {
  const now = Date.now();
  const prev = map.get(key);
  if (!prev || now - prev.at > WINDOW_MS) {
    map.set(key, { at: now, count: 1 });
    return true;
  }
  if (prev.count >= limit) return false;
  prev.count += 1;
  return true;
}

export function gifSessionIdFromCookie(header: string | null): string {
  const match = header?.match(/(?:^|;\s*)hc_gif_sid=([0-9a-f]{32})/i);
  return match?.[1] ?? "";
}

export function newGifSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function sessionCookie(id: string): string {
  return `hc_gif_sid=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
}

function dim(value: unknown): { width: number; height: number } {
  if (!Array.isArray(value) || value.length < 2) return { width: 0, height: 0 };
  const width = Number(value[0]);
  const height = Number(value[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { width: 0, height: 0 };
  return { width, height };
}

export function stripTenorResults(payload: unknown): GifMedia[] {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: GifMedia[] = [];
  for (const row of results as TenorResult[]) {
    if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 64) continue;
    const formats = row.media_formats ?? {};
    const preview = formats.tinygif ?? formats.nanogif ?? formats.gif;
    const gif = formats.gif ?? formats.tinygif;
    const previewUrl = typeof preview?.url === "string" ? preview.url : "";
    const gifUrl = typeof gif?.url === "string" ? gif.url : "";
    if (!previewUrl.startsWith("https://") || !gifUrl.startsWith("https://")) continue;
    const size = dim(gif?.dims ?? preview?.dims);
    out.push({
      id: row.id,
      previewUrl,
      gifUrl,
      width: size.width,
      height: size.height,
    });
    allow.set(row.id, { gifUrl, previewUrl, expires: Date.now() + 10 * 60_000 });
  }
  return out.slice(0, 24);
}

export function allowedGifUrl(id: string, kind: "gif" | "preview" = "gif"): string | null {
  const row = allow.get(id);
  if (!row) return null;
  if (row.expires < Date.now()) {
    allow.delete(id);
    return null;
  }
  return kind === "preview" ? row.previewUrl : row.gifUrl;
}

export async function searchTenor(query: string, sessionId: string): Promise<
  | { status: 200; body: { items: Array<{ id: string; width: number; height: number }> } }
  | { status: 429; body: { error: string } }
  | { status: 503; body: { error: string; code: "not-configured" } }
  | { status: 400; body: { error: string } }
> {
  const key = process.env.TENOR_API_KEY;
  if (!key) {
    return { status: 503, body: { error: "GIF search not configured", code: "not-configured" } };
  }
  if (!take(searchHits, sessionId, SEARCH_LIMIT)) {
    return { status: 429, body: { error: "Too many GIF searches. Try again in a minute." } };
  }
  const q = query.trim().slice(0, 64);
  if (!q) return { status: 400, body: { error: "Enter a search." } };
  const url = new URL("https://tenor.googleapis.com/v2/search");
  url.searchParams.set("q", q);
  url.searchParams.set("key", key);
  url.searchParams.set("limit", "20");
  url.searchParams.set("media_filter", "gif,tinygif,nanogif");
  url.searchParams.set("client_key", "hypercolor-web");
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    return { status: 503, body: { error: "GIF search not configured", code: "not-configured" } };
  }
  const json: unknown = await res.json();
  return { status: 200, body: { items: stripTenorResults(json).map(({ id, width, height }) => ({ id, width, height })) } };
}

export async function fetchTenorGif(
  id: string,
  sessionId: string,
  kind: "gif" | "preview" = "gif",
): Promise<
  | { status: 200; bytes: Uint8Array; contentType: string }
  | { status: 404; body: { error: string } }
  | { status: 429; body: { error: string } }
  | { status: 503; body: { error: string; code: "not-configured" } }
> {
  if (!process.env.TENOR_API_KEY) {
    return { status: 503, body: { error: "GIF search not configured", code: "not-configured" } };
  }
  if (!take(fetchHits, sessionId, FETCH_LIMIT)) {
    return { status: 429, body: { error: "Too many GIF downloads. Try again in a minute." } };
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return { status: 404, body: { error: "Unknown GIF." } };
  }
  const gifUrl = allowedGifUrl(id, kind);
  if (!gifUrl) return { status: 404, body: { error: "Unknown GIF." } };
  const res = await fetch(gifUrl, { cache: "no-store", redirect: "follow" });
  const length = Number(res.headers.get("content-length") ?? "0");
  if (length > ATTACHMENT_MAX_BYTES) {
    return { status: 404, body: { error: "GIF is larger than 8 MiB." } };
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > ATTACHMENT_MAX_BYTES) {
    return { status: 404, body: { error: "GIF is larger than 8 MiB." } };
  }
  const type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/gif";
  if (type !== "image/gif" && type !== "image/webp") {
    return { status: 404, body: { error: "GIF is not an image." } };
  }
  return { status: 200, bytes: buf, contentType: type };
}
