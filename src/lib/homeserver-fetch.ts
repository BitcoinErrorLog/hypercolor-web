/**
 * Browser HTTP cache keys by URL, not by the `pubky-host` header.
 * Staging 404s for handshake slots send neither `Cache-Control` nor
 * `vary: pubky-host` (200s send both). A responder that probes slot `/0`
 * before the initiator's PUT therefore caches the miss and never sees msg1.
 *
 * GET/HEAD of Paykit private paths are ciphertext and are readable without
 * a session cookie (curl without cookies returns 200). Sending
 * `credentials: include` on those GETs can attach the responder's session
 * cookie to the initiator's host and yield a durable 404. PUTs are unchanged.
 */

const PRIVATE_PAYKIT_PATH = /\/pub\/paykit\/v0\/private\//;

type FetchLike = typeof fetch;

let installed = false;
let originalFetch: FetchLike | null = null;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

export function isPubkyPrivateGet(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = requestMethod(input, init);
  if (method !== "GET" && method !== "HEAD") return false;
  return PRIVATE_PAYKIT_PATH.test(requestUrl(input));
}

function applyGuard(init: RequestInit | undefined): RequestInit {
  return { ...init, cache: "no-store", credentials: "omit" };
}

async function guardedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const orig = originalFetch;
  if (!orig) {
    throw new Error("pubky private fetch guard is not installed");
  }
  if (!isPubkyPrivateGet(input, init)) {
    return orig(input as never, init);
  }
  if (typeof Request !== "undefined" && input instanceof Request) {
    return orig(new Request(input, applyGuard(init)));
  }
  return orig(input as never, applyGuard(init));
}

export function installPubkyPrivateFetchGuard(opts?: { force?: boolean }): void {
  if (installed) return;
  // Client-module evaluation during Next SSR must not patch Node fetch.
  if (!opts?.force && typeof window === "undefined") return;
  const g = globalThis as typeof globalThis & { fetch?: FetchLike };
  if (typeof g.fetch !== "function") return;
  originalFetch = g.fetch.bind(g);
  g.fetch = guardedFetch as FetchLike;
  installed = true;
}

export function uninstallPubkyPrivateFetchGuard(): void {
  if (!installed || !originalFetch) return;
  (globalThis as typeof globalThis & { fetch?: FetchLike }).fetch = originalFetch;
  originalFetch = null;
  installed = false;
}

export function isPubkyPrivateFetchGuardInstalled(): boolean {
  return installed;
}
