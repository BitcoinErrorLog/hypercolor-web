import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ATTACHMENT_MAX_BYTES } from "@/flags/config";

export type GifProxyHit = {
  id: string;
  preview: { url: string; w: number; h: number };
  gif: { url: string; w: number; h: number; bytes?: number };
};

export type GifMedia = {
  id: string;
  previewUrl: string;
  gifUrl: string;
  previewWidth: number;
  previewHeight: number;
  width: number;
  height: number;
  bytes?: number;
};

type TenorFormat = { url?: unknown; dims?: unknown; size?: unknown };
type TenorResult = { id?: unknown; media_formats?: Record<string, TenorFormat> };

const WINDOW_MS = 60_000;
const SEARCH_LIMIT = 30;
const FETCH_LIMIT = 30;
const PREVIEW_LIMIT = 120;
const SID_TTL_SEC = 86_400;
const TOKEN_TTL_SEC = 10 * 60;
const UPSTREAM_TIMEOUT_MS = 8_000;
const DEFAULT_APP_ORIGIN = "https://hypercolor.app";
const FETCH_TOKEN_DOMAIN = "hypercolor-gif-fetch-v1";
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
const ALLOWED_GIF_TYPES = new Set(["image/gif"]);
const GIF_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Bucket = { at: number; count: number };

const searchHits = new Map<string, Bucket>();
const fetchHits = new Map<string, Bucket>();
const previewHits = new Map<string, Bucket>();

function gifProxySecret(): string | null {
  const dedicated = process.env.GIF_PROXY_SECRET?.trim();
  if (dedicated) return dedicated;
  const tenor = process.env.TENOR_API_KEY?.trim();
  if (!tenor) return null;
  return createHmac("sha256", tenor).update("hypercolor-gif-proxy-sid").digest("hex");
}

/** True only when a Tenor key is present. Does not return the key. */
export function gifSearchConfigured(): boolean {
  return Boolean(process.env.TENOR_API_KEY?.trim()) && gifProxySecret() !== null;
}

function signPayload(payload: string): string {
  const secret = gifProxySecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function verifyMac(payload: string, mac: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(mac)) return false;
  const expected = signPayload(payload);
  if (!expected) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(mac.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function resolveGifProxyOrigin(requestOrigin?: string | null): string {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  for (const candidate of [configured, requestOrigin]) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return parsed.origin;
      }
    } catch {
      // Try next fallback.
    }
  }
  return DEFAULT_APP_ORIGIN;
}

export function mintGifFetchToken(
  params: {
    id: string;
    kind: "gif" | "preview";
    url: string;
    ttlSec?: number;
  },
): string | null {
  if (!GIF_ID_RE.test(params.id) || !isTenorMediaUrl(params.url)) return null;
  const ttlSec = params.ttlSec ?? TOKEN_TTL_SEC;
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payloadJson = JSON.stringify({
    v: 1,
    id: params.id,
    kind: params.kind,
    url: params.url,
    exp,
  });
  const encoded = Buffer.from(payloadJson, "utf8").toString("base64url");
  const mac = signPayload(`${FETCH_TOKEN_DOMAIN}:${encoded}`);
  if (!mac) return null;
  return `${encoded}.${mac}`;
}

export function verifyGifFetchToken(
  token: string,
  expectedId: string,
  expectedKind: "gif" | "preview",
): string | null {
  if (!token || token.length > 2048) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const encoded = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  if (!verifyMac(`${FETCH_TOKEN_DOMAIN}:${encoded}`, mac)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const row = parsed as Record<string, unknown>;
  if (row.v !== 1) return null;
  if (row.id !== expectedId || !GIF_ID_RE.test(expectedId)) return null;
  if (row.kind !== expectedKind) return null;
  if (typeof row.exp !== "number" || !Number.isInteger(row.exp)) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (row.exp < nowSec || row.exp > nowSec + TOKEN_TTL_SEC + 60) return null;
  if (typeof row.url !== "string" || !isTenorMediaUrl(row.url)) return null;
  return row.url;
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
  const signed = cookieValue.match(/^([0-9a-f]{32})\.(\d{1,10})\.([0-9a-f]{64})$/i);
  if (!signed) {
    return { present: true, valid: false, sid: "", cookieValue };
  }
  const id = signed[1].toLowerCase();
  const exp = Number(signed[2]);
  const mac = signed[3];
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return { present: true, valid: false, sid: "", cookieValue };
  }
  if (!verifyMac(`${id}.${exp}`, mac)) {
    return { present: true, valid: false, sid: "", cookieValue };
  }
  return { present: true, valid: true, sid: id, cookieValue };
}

export function gifSessionIdFromCookie(header: string | null): string {
  const parsed = parseGifSessionCookie(header);
  return parsed.valid ? parsed.sid : "";
}

export function newGifSessionId(ttlSec = SID_TTL_SEC): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${id}.${exp}`;
  const mac = signPayload(payload);
  if (!mac) return "";
  return `${payload}.${mac}`;
}

export function sessionCookie(id: string): string {
  return `hc_gif_sid=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SID_TTL_SEC}`;
}

export function expireSessionCookie(): string {
  return `hc_gif_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export type BoundGifSession = {
  sid: string;
  cookieValue: string;
  reissued: boolean;
  hadInvalid: boolean;
};

export function bindGifSession(cookieHeader: string | null): BoundGifSession {
  const parsed = parseGifSessionCookie(cookieHeader);
  if (parsed.valid) {
    return {
      sid: parsed.sid,
      cookieValue: parsed.cookieValue,
      reissued: false,
      hadInvalid: false,
    };
  }
  const cookieValue = newGifSessionId();
  const sid = parseGifSessionCookie(`hc_gif_sid=${cookieValue}`).sid;
  return { sid, cookieValue, reissued: true, hadInvalid: parsed.present };
}

export function appendGifSessionCookies(headers: Headers, session: BoundGifSession): void {
  if (session.hadInvalid) headers.append("Set-Cookie", expireSessionCookie());
  if (session.reissued && session.cookieValue) {
    headers.append("Set-Cookie", sessionCookie(session.cookieValue));
  }
}

export function clientIpFromHeaders(headers: { get(name: string): string | null }): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.split(",")[0]?.trim() || "unknown";
  const vercel = headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) return vercel.split(",")[0]?.trim() || "unknown";
  const hops = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return hops.at(-1) || "unknown";
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
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  return { width: Math.floor(width), height: Math.floor(height) };
}

function positiveBytes(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

export function stripTenorResults(payload: unknown): GifMedia[] {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: GifMedia[] = [];
  for (const row of results as TenorResult[]) {
    if (typeof row.id !== "string" || !GIF_ID_RE.test(row.id)) continue;
    const formats = row.media_formats ?? {};
    const preview = formats.tinygif ?? formats.nanogif ?? formats.gif;
    const gif = formats.gif ?? formats.tinygif;
    const previewUrl = typeof preview?.url === "string" ? preview.url : "";
    const gifUrl = typeof gif?.url === "string" ? gif.url : "";
    if (!isTenorMediaUrl(previewUrl) || !isTenorMediaUrl(gifUrl)) continue;
    const bytes = positiveBytes(gif?.size);
    if (bytes !== undefined && bytes > ATTACHMENT_MAX_BYTES) continue;
    const gifSize = dim(gif?.dims ?? preview?.dims);
    const previewSize = dim(preview?.dims ?? gif?.dims);
    if (gifSize.width <= 0 || gifSize.height <= 0 || previewSize.width <= 0 || previewSize.height <= 0) {
      continue;
    }
    out.push({
      id: row.id,
      previewUrl,
      gifUrl,
      previewWidth: previewSize.width,
      previewHeight: previewSize.height,
      width: gifSize.width,
      height: gifSize.height,
      ...(bytes !== undefined ? { bytes } : {}),
    });
  }
  return out.slice(0, 24);
}

function buildSignedProxyHit(media: GifMedia, origin: string): GifProxyHit | null {
  const previewToken = mintGifFetchToken({
    id: media.id,
    kind: "preview",
    url: media.previewUrl,
  });
  const gifToken = mintGifFetchToken({
    id: media.id,
    kind: "gif",
    url: media.gifUrl,
  });
  if (!previewToken || !gifToken) return null;
  const previewProxyUrl = `${origin}/api/gif/fetch?id=${encodeURIComponent(media.id)}&kind=preview&token=${encodeURIComponent(previewToken)}`;
  const gifProxyUrl = `${origin}/api/gif/fetch?id=${encodeURIComponent(media.id)}&kind=gif&token=${encodeURIComponent(gifToken)}`;
  return {
    id: media.id,
    preview: {
      url: previewProxyUrl,
      w: media.previewWidth,
      h: media.previewHeight,
    },
    gif: {
      url: gifProxyUrl,
      w: media.width,
      h: media.height,
      ...(media.bytes !== undefined ? { bytes: media.bytes } : {}),
    },
  };
}

function isGifMagic(buffer: Uint8Array): boolean {
  if (buffer.byteLength < 6) return false;
  if (buffer[0] !== 0x47 || buffer[1] !== 0x49 || buffer[2] !== 0x46 || buffer[3] !== 0x38) {
    return false;
  }
  return (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61;
}

type PinnedFetchResult =
  | { ok: true; response: Response }
  | { ok: false; status: 404 | 413 | 429 | 502 };

async function fetchPinnedMedia(url: string): Promise<PinnedFetchResult> {
  if (!isTenorMediaUrl(url)) return { ok: false, status: 404 };
  const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", redirect: "manual", signal });
  } catch {
    return { ok: false, status: 502 };
  }
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location) return { ok: false, status: 404 };
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      return { ok: false, status: 404 };
    }
    if (!isTenorMediaUrl(next.href)) return { ok: false, status: 404 };
    let hop: Response;
    try {
      hop = await fetch(next, { cache: "no-store", redirect: "manual", signal });
    } catch {
      return { ok: false, status: 502 };
    }
    if (hop.status >= 300 && hop.status < 400) return { ok: false, status: 404 };
    if (hop.status === 413) return { ok: false, status: 413 };
    if (hop.status === 429) return { ok: false, status: 429 };
    if (hop.status === 404) return { ok: false, status: 404 };
    if (!hop.ok) return { ok: false, status: 502 };
    return { ok: true, response: hop };
  }
  if (res.status === 413) return { ok: false, status: 413 };
  if (res.status === 429) return { ok: false, status: 429 };
  if (res.status === 404) return { ok: false, status: 404 };
  if (!res.ok) return { ok: false, status: 502 };
  return { ok: true, response: res };
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
  options: { limit?: number; origin?: string | null } = {},
): Promise<
  | { status: 200; body: { results: GifProxyHit[] } }
  | { status: 400; body: { error: string } }
  | { status: 429; body: { error: string } }
  | { status: 502; body: { error: string } }
  | { status: 503; body: { error: string; code: "not-configured" } }
> {
  const key = process.env.TENOR_API_KEY?.trim();
  if (!key || !gifProxySecret()) {
    return { status: 503, body: { error: "GIF search not configured", code: "not-configured" } };
  }
  sweepHits(searchHits);
  if (!take(searchHits, `ip:${clientIp}`, SEARCH_LIMIT) || !take(searchHits, `sid:${sessionId}`, SEARCH_LIMIT)) {
    return { status: 429, body: { error: "Too many GIF searches. Try again in a minute." } };
  }
  const q = query.trim().slice(0, 64);
  if (!q) return { status: 400, body: { error: "Enter a search." } };
  const rawLimit = options.limit ?? 20;
  const limit = Number.isFinite(rawLimit) ? Math.min(24, Math.max(1, Math.floor(rawLimit))) : 20;
  const url = new URL("https://tenor.googleapis.com/v2/search");
  url.searchParams.set("q", q);
  url.searchParams.set("key", key);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("media_filter", "gif,tinygif,nanogif");
  url.searchParams.set("client_key", "hypercolor-web");
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return { status: 502, body: { error: "GIF search temporarily unavailable." } };
  }
  if (res.status === 429) {
    return { status: 429, body: { error: "GIF search rate limited. Try again shortly." } };
  }
  if (!res.ok) {
    return { status: 502, body: { error: "GIF search temporarily unavailable." } };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { status: 502, body: { error: "GIF search returned an invalid response." } };
  }
  const origin = resolveGifProxyOrigin(options.origin);
  const hits: GifProxyHit[] = [];
  for (const media of stripTenorResults(json).slice(0, limit)) {
    const signed = buildSignedProxyHit(media, origin);
    if (signed) hits.push(signed);
  }
  return {
    status: 200,
    body: { results: hits },
  };
}

export async function fetchTenorGif(
  id: string,
  sessionId: string,
  kind: "gif" | "preview" = "gif",
  clientIp = "unknown",
  token = "",
): Promise<
  | { status: 200; bytes: Uint8Array; contentType: "image/gif" }
  | { status: 403; body: { error: string } }
  | { status: 404; body: { error: string } }
  | { status: 413; body: { error: string } }
  | { status: 429; body: { error: string } }
  | { status: 502; body: { error: string } }
  | { status: 503; body: { error: string; code: "not-configured" } }
> {
  if (!process.env.TENOR_API_KEY?.trim() || !gifProxySecret()) {
    return { status: 503, body: { error: "GIF search not configured", code: "not-configured" } };
  }
  const hits = kind === "preview" ? previewHits : fetchHits;
  const limit = kind === "preview" ? PREVIEW_LIMIT : FETCH_LIMIT;
  sweepHits(hits);
  if (!take(hits, `ip:${clientIp}`, limit) || (sessionId && !take(hits, `sid:${sessionId}`, limit))) {
    return { status: 429, body: { error: "Too many GIF downloads. Try again in a minute." } };
  }
  if (!GIF_ID_RE.test(id)) {
    return { status: 404, body: { error: "Unknown GIF." } };
  }
  const gifUrl = verifyGifFetchToken(token, id, kind);
  if (!gifUrl) {
    return { status: 403, body: { error: "Invalid or expired GIF token." } };
  }
  const upstream = await fetchPinnedMedia(gifUrl);
  if (!upstream.ok) {
    if (upstream.status === 413) {
      return { status: 413, body: { error: "GIF is larger than 8 MiB." } };
    }
    if (upstream.status === 429) {
      return { status: 429, body: { error: "GIF downloads rate limited. Try again shortly." } };
    }
    if (upstream.status === 502) {
      return { status: 502, body: { error: "GIF upstream unavailable." } };
    }
    return { status: 404, body: { error: "Unknown GIF." } };
  }
  const res = upstream.response;
  const type = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_GIF_TYPES.has(type)) {
    return { status: 502, body: { error: "Upstream response is not a GIF." } };
  }
  const length = Number(res.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(length) && length > ATTACHMENT_MAX_BYTES) {
    return { status: 413, body: { error: "GIF is larger than 8 MiB." } };
  }
  let buf: Uint8Array | null;
  try {
    buf = await readCappedBody(res);
  } catch {
    return { status: 502, body: { error: "GIF upstream failed during download." } };
  }
  if (!buf) {
    return { status: 413, body: { error: "GIF is larger than 8 MiB." } };
  }
  if (!isGifMagic(buf)) {
    return { status: 502, body: { error: "Upstream response is not a GIF." } };
  }
  return { status: 200, bytes: buf, contentType: "image/gif" };
}
