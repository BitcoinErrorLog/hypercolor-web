import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installPubkyPrivateFetchGuard,
  isPubkyPrivateFetchGuardInstalled,
  isPubkyPrivateGet,
  uninstallPubkyPrivateFetchGuard,
} from "./homeserver-fetch";

const SLOT_0 =
  "https://homeserver.staging.pubky.app/pub/paykit/v0/private/hypercolor/wallet/messages/5e261c8a1690e83c81a5fbe3e2f6f20212014045df9382157db21929b1241262/0";
const ALICE = "4k87curxyzswqzi6qjss5ygff7ye5tftumke7fbxpej1z1ok4mqy";

/** Captured 2026-09-21 gate: 404 has no Cache-Control and no vary: pubky-host. */
const STAGING_404_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  vary: "origin, access-control-request-method, access-control-request-headers",
  "access-control-allow-credentials": "true",
};

/** Captured 2026-09-21 gate: 200 has cache-control and vary: pubky-host. */
const STAGING_200_HEADERS = {
  "content-type": "application/octet-stream",
  "cache-control": "private, must-revalidate",
  vary: "pubky-host",
  "access-control-allow-credentials": "true",
};

const MSG1 = new Uint8Array(1018).fill(7);

function jsonHeaders(init: HeadersInit | undefined): Record<string, string> {
  const headers = new Headers(init);
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

describe("isPubkyPrivateGet", () => {
  it("matches handshake slot GETs and ignores PUTs and public markers", () => {
    expect(isPubkyPrivateGet(SLOT_0)).toBe(true);
    expect(isPubkyPrivateGet(SLOT_0, { method: "HEAD" })).toBe(true);
    expect(isPubkyPrivateGet(SLOT_0, { method: "PUT" })).toBe(false);
    expect(
      isPubkyPrivateGet(
        "https://homeserver.staging.pubky.app/pub/paykit/v0/hypercolor/wallet/receiver.json",
      ),
    ).toBe(false);
  });
});

describe("installPubkyPrivateFetchGuard", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    uninstallPubkyPrivateFetchGuard();
    globalThis.fetch = originalFetch;
  });

  it("forces cache:no-store and credentials:omit on private GETs so a 404 miss cannot stick", async () => {
    let live = false;
    const seen: Array<{ cache?: RequestCache; credentials?: RequestCredentials }> = [];
    const urlCache = new Map<string, Response>();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ cache: init?.cache, credentials: init?.credentials });
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (init?.cache === "default" || init?.cache === undefined) {
        const cached = urlCache.get(url);
        if (cached) return cached.clone();
      }
      if (!live) {
        const miss = new Response("Not Found", { status: 404, headers: STAGING_404_HEADERS });
        urlCache.set(url, miss.clone());
        return miss;
      }
      return new Response(MSG1, { status: 200, headers: STAGING_200_HEADERS });
    }) as typeof fetch;

    const unguardedMiss = await globalThis.fetch(SLOT_0, {
      headers: { "pubky-host": ALICE },
    });
    expect(unguardedMiss.status).toBe(404);
    live = true;
    const unguardedAfterPut = await globalThis.fetch(SLOT_0, {
      headers: { "pubky-host": ALICE },
    });
    expect(unguardedAfterPut.status).toBe(404);

    installPubkyPrivateFetchGuard({ force: true });
    const guarded = await globalThis.fetch(SLOT_0, {
      headers: { "pubky-host": ALICE },
      credentials: "include",
    });
    expect(guarded.status).toBe(200);
    expect((await guarded.arrayBuffer()).byteLength).toBe(1018);
    expect(seen.at(-1)).toEqual({ cache: "no-store", credentials: "omit" });
  });

  it("does not rewrite PUT of the responder msg2 slot", async () => {
    const inner = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 201 }),
    );
    globalThis.fetch = inner as unknown as typeof fetch;
    installPubkyPrivateFetchGuard({ force: true });
    await globalThis.fetch(SLOT_0.replace(/\/0$/, "/1"), {
      method: "PUT",
      credentials: "include",
      body: MSG1,
    });
    expect(inner).toHaveBeenCalledTimes(1);
    const init = inner.mock.calls[0]?.[1];
    expect(init?.method).toBe("PUT");
    expect(init?.cache).toBeUndefined();
    expect(init?.credentials).toBe("include");
  });

  it("unwraps Request objects the wasm client builds", async () => {
    const inner = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(MSG1, { status: 200, headers: STAGING_200_HEADERS }),
    );
    globalThis.fetch = inner as unknown as typeof fetch;
    installPubkyPrivateFetchGuard({ force: true });
    const request = new Request(SLOT_0, {
      headers: { "pubky-host": ALICE },
      credentials: "include",
    });
    await globalThis.fetch(request);
    const passed = inner.mock.calls[0]?.[0];
    expect(passed).toBeInstanceOf(Request);
    expect((passed as Request).cache).toBe("no-store");
    expect((passed as Request).credentials).toBe("omit");
    expect(jsonHeaders((passed as Request).headers)["pubky-host"]).toBe(ALICE);
  });

  it("does not patch fetch during SSR when window is missing", () => {
    const inner = vi.fn();
    globalThis.fetch = inner as unknown as typeof fetch;
    installPubkyPrivateFetchGuard();
    expect(isPubkyPrivateFetchGuardInstalled()).toBe(false);
    expect(globalThis.fetch).toBe(inner);
  });
});
