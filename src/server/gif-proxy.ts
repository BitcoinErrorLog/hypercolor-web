import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
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
const ALLOW_TTL_MS = 10 * 60_000;
const ALLOW_MAX = 256;
const UPSTREAM_TIMEOUT_MS = 8_000;
const TENOR_MEDIA_HOSTS = new Set([
  "media.tenor.com",
  "media1.tenor.com",
  "media2.tenor.com",
  "media3.tenor.com",
  "media4.tenor.com",
  "c.tenor.com",
  "media.giphy.com",
  "media0.giphy.com",
  "media1.giphy.com",
  "media2.giphy.com",
  "media3.giphy.com",
  "media4.giphy.com",
]);
const ALLOWED_GIF_TYPES = new Set(["image/gif", "image/webp", "video/mp4"]);

type Bucket = { at: number; count: number };
type AllowRow = { gifUrl: string; previewUrl: string; expires: number };

const searchHits = new Map<string, Bucket>();
const fetchHits = new Map<string, Bucket>();
const allow = new Map<string, AllowRow>();

function gifProxySecret(): string | null {
  const dedicated = process.env.GIF_PROXY_SECRET?.trim();
  if (dedicated) return dedicated;
  const tenor = process.env.TENOR_API_KEY?.trim();
  if (!tenor) return null;
  return createHmac("sha256", tenor).update("hypercolor-gif-proxy-sid").digest("hex");
}

function signSid(id: string): string {
  const secret = gifProxySecret();
  if (!secret) return "";
  return `${id}.${createHmac("sha256", secret).update(id).digest("hex")}`;
}

function verifySid(id: string, mac: string): boolean {
  const secret = gifProxySecret();
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(id).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(mac.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type GifSessionParse = {
  present: boolean;
  valid: boolean;
  sid: string;
  cookieValue: string;
};

export function parseGifSessionCookie(header: string | null): GifSessionParse {
  const match = header?.match(/(?:^|;\s*)hc_gif_sid=([^;]+)/i);
  if (!match) return { present: false, valid: false, sid: "", cookieValue: "" };
  const cookieValue = match[1].trim();
  const signed = cookieValue.match(/^([0-9a-f]{32})\.([0-9a-f]{64})$/i);
  if (!signed || !verifySid(signed[1].toLowerCase(), signed[2])) {
    return { present: true, valid: false, sid: "", cookieValue };
  }
  const sid = signed[1].toLowerCase();
  return { present: true, valid: true, sid, cookieValue };
}

export function gifSessionIdFromCookie(header: string | null): string {
  const parsed = parseGifSessionCookie(header);
  return parsed.valid ? parsed.sid : "";
}

export function newGifSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return signSid(id);
}

export function sessionCookie(id: string): string {
  return `hc_gif_sid=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
}

export function clientIpFromHeaders(xff: string | null, fallback = ""): string {
  const first = (xff ?? "").split(",")[0]?.trim() ?? "";
  return first || fallback || "unknown";
}

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

function sweepHits(map: Map<string, Bucket>): void {
  const now = Date.now();
  for (const [key, bucket] of map) {
    if (now - bucket.at > WINDOW_MS) map.delete(key);
  }
}

function sweepAllow(): void {
  const now = Date.now();
  for (const [key, row] of allow) {
    if (row.expires < now) allow.delete(key);
  }
  if (allow.size <= ALLOW_MAX) return;
  const ranked = [...allow.entries()].sort((a, b) => a[1].expires - b[1].expires);
  for (let i = 0; i < ranked.length - ALLOW_MAX; i += 1) {
    allow.delete(ranked[i][0]);
  }
}

function allowKey(sessionId: string, id: string): string {
  return `${sessionId}:${id}`;
}

export function isTenorMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (url.port && url.port !== "443") return false;
    return TENOR_MEDIA_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function dim(value: unknown): { width: number; height: number } {
  if (!Array.isArray(value) || value.length < 2) return { width: 0, height: 0 };
  const width = Number(value[0]);
  const height = Number(value[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { width: 0, height: 0 };
  return { width, height };
}

export function stripTenorResults(payload: unknown, sessionId = ""): GifMedia[] {
  sweepAllow();
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
    if (!isTenorMediaUrl(previewUrl) || !isTenorMediaUrl(gifUrl)) continue;
    const size = dim(gif?.dims ?? preview?.dims);
    out.push({
      id: row.id,
      previewUrl,
      gifUrl,
      width: size.width,
      height: size.height,
    });
    if (sessionId) {
      allow.set(allowKey(sessionId, row.id), {
        gifUrl,
        previewUrl,
        expires: Date.now() + ALLOW_TTL_MS,
      });
    }
  }
  sweepAllow();
  return out.slice(0, 24);
}

export function allowedGifUrl(
  sessionId: string,
  id: string,
  kind: "gif" | "preview" = "gif",
): string | null {
  const row = allow.get(allowKey(sessionId, id));
  if (!row) return null;
  if (row.expires < Date.now()) {
    allow.delete(allowKey(sessionId, id));
    return null;
  }
  return kind === "preview" ? row.previewUrl : row.gifUrl;
}

async function fetchPinnedMedia(url: string): Promise<Response | null> {
  if (!isTenorMediaUrl(url)) return null;
  const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const res = await fetch(url, { cache: "no-store", redirect: "manual", signal });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location) return null;
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      return null;
    }
    if (!isTenorMediaUrl(next.href)) return null;
    const hop = await fetch(next, { cache: "no-store", redirect: "manual", signal });
    if (hop.status >= 300 && hop.status < 400) return null;
    if (!hop.ok) return null;
    return hop;
  }
  if (!res.ok) return null;
  return res;
}

async function readCappedBody(res: Response): Promise<Uint8Array | null> {
  const length = Number(res.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(length) && length > ATTACHMENT_MAX_BYTES) return null;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > ATTACHMENT_MAX_BYTES ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > ATTACHMENT_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function searchTenor(
  query: string,
  sessionId: string,
  clientIp = "unknown",
): Promise<
  | { status: 200; body: { items: Array<{ id: string; width: number; height: number }> } }
  | { status: 429; body: { error: string } }
  | { status: 503; body: { error: string; code: "not-configured" } }
  | { status: 400; body: { error: string } }
> {
  const key = process.env.TENOR_API_KEY;
  if (!key || !gifProxySecret()) {
    return { status: 503, body: { error: "GIF search not configured", code: "not-configured" } };
  }
  sweepHits(searchHits);
  if (!take(searchHits, `ip:${clientIp}`, SEARCH_LIMIT) || !take(searchHits, `sid:${sessionId}`, SEARCH_LIMIT)) {
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
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    return { status: 503, body: { error: "GIF search not configured", code: "not-configured" } };
  }
  const json: unknown = await res.json();
  return {
    status: 200,
    body: { items: stripTenorResults(json, sessionId).map(({ id, width, height }) => ({ id, width, height })) },
  };
}

export async function fetchTenorGif(
  id: string,
  sessionId: string,
  kind: "gif" | "preview" = "gif",
  clientIp = "unknown",
): Promise<
  | { status: 200; bytes: Uint8Array; contentType: string }
  | { status: 404; body: { error: string } }
  | { status: 429; body: { error: string } }
  | { status: 503; body: { error: string; code: "not-configured" } }
> {
  if (!process.env.TENOR_API_KEY || !gifProxySecret()) {
    return { status: 503, body: { error: "GIF search not configured", code: "not-configured" } };
  }
  sweepHits(fetchHits);
  if (!take(fetchHits, `ip:${clientIp}`, FETCH_LIMIT) || !take(fetchHits, `sid:${sessionId}`, FETCH_LIMIT)) {
    return { status: 429, body: { error: "Too many GIF downloads. Try again in a minute." } };
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return { status: 404, body: { error: "Unknown GIF." } };
  }
  const gifUrl = allowedGifUrl(sessionId, id, kind);
  if (!gifUrl || !isTenorMediaUrl(gifUrl)) return { status: 404, body: { error: "Unknown GIF." } };
  const res = await fetchPinnedMedia(gifUrl);
  if (!res) return { status: 404, body: { error: "Unknown GIF." } };
  const type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!ALLOWED_GIF_TYPES.has(type)) {
    return { status: 404, body: { error: "GIF is not an image." } };
  }
  const length = Number(res.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(length) && length > ATTACHMENT_MAX_BYTES) {
    return { status: 404, body: { error: "GIF is larger than 8 MiB." } };
  }
  const buf = await readCappedBody(res);
  if (!buf) {
    return { status: 404, body: { error: "GIF is larger than 8 MiB." } };
  }
  return { status: 200, bytes: buf, contentType: type };
}
