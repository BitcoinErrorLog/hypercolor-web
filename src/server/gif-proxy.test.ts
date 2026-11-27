import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ATTACHMENT_MAX_BYTES } from "@/flags/config";
import {
  gifSearchConfigured,
  mintGifFetchToken,
  newGifSessionId,
  parseGifSessionCookie,
  stripTenorResults,
  verifyGifFetchToken,
  type GifProxyHit,
} from "./gif-proxy";
import { GET as configGet } from "../../app/api/gif/config/route";
import { GET as searchGet } from "../../app/api/gif/search/route";
import { GET as fetchGet } from "../../app/api/gif/fetch/route";

const GIF89A_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);

const TENOR_JSON = {
  results: [
    {
      id: "abc",
      media_formats: {
        gif: { url: "https://media.tenor.com/x.gif", dims: [100, 80], size: 2048 },
        tinygif: { url: "https://media.tenor.com/x-tiny.gif", dims: [50, 40], size: 512 },
      },
    },
  ],
};

function req(path: string, headers: Record<string, string> = {}) {
  const full = path.startsWith("http") ? path : `https://hypercolor.app${path}`;
  return new NextRequest(full, { headers });
}

function cookieHeader(value: string) {
  return { cookie: `hc_gif_sid=${value}` };
}

describe("gif proxy", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.TENOR_API_KEY = "test-tenor-key";
    process.env.GIF_PROXY_SECRET = "test-gif-secret";
    process.env.NEXT_PUBLIC_APP_ORIGIN = "https://hypercolor.app";
  });

  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps only tenor media urls and drops oversized advertised gifs", () => {
    const items = stripTenorResults({
      results: [
        {
          id: "abc",
          media_formats: {
            gif: { url: "https://media.tenor.com/x.gif", dims: [100, 80], size: 2048 },
            tinygif: { url: "https://media.tenor.com/x-tiny.gif", dims: [50, 40], size: 512 },
          },
          itemurl: "https://tenor.com/view/secret",
        },
        { id: "bad", media_formats: { gif: { url: "https://evil.example/x.gif", dims: [10, 10] } } },
        {
          id: "huge",
          media_formats: {
            gif: {
              url: "https://media.tenor.com/huge.gif",
              dims: [100, 80],
              size: ATTACHMENT_MAX_BYTES + 1,
            },
            tinygif: { url: "https://media.tenor.com/huge-tiny.gif", dims: [50, 40] },
          },
        },
      ],
    });
    expect(items).toEqual([
      {
        id: "abc",
        previewUrl: "https://media.tenor.com/x-tiny.gif",
        gifUrl: "https://media.tenor.com/x.gif",
        previewWidth: 50,
        previewHeight: 40,
        width: 100,
        height: 80,
        bytes: 2048,
      },
    ]);
  });

  it("mints and verifies stateless HMAC fetch tokens and rejects tampered, expired, or mismatched tokens", () => {
    const token = mintGifFetchToken({
      id: "abc",
      kind: "gif",
      url: "https://media.tenor.com/x.gif",
    });
    expect(token).toBeTruthy();
    expect(verifyGifFetchToken(token!, "abc", "gif")).toBe("https://media.tenor.com/x.gif");
    expect(verifyGifFetchToken(token!, "other", "gif")).toBeNull();
    expect(verifyGifFetchToken(token!, "abc", "preview")).toBeNull();
    expect(verifyGifFetchToken(`${token!.slice(0, -1)}0`, "abc", "gif")).toBeNull();

    const expired = mintGifFetchToken({
      id: "abc",
      kind: "gif",
      url: "https://media.tenor.com/x.gif",
      ttlSec: -10,
    });
    expect(expired).toBeTruthy();
    expect(verifyGifFetchToken(expired!, "abc", "gif")).toBeNull();

    expect(
      mintGifFetchToken({
        id: "abc",
        kind: "gif",
        url: "https://evil.example/x.gif",
      }),
    ).toBeNull();
  });

  it("returns 503 when Tenor is not configured", async () => {
    delete process.env.TENOR_API_KEY;
    delete process.env.GIF_PROXY_SECRET;
    expect(gifSearchConfigured()).toBe(false);
    const res = await searchGet(req("/api/gif/search?q=hi", { "x-forwarded-for": "198.51.100.1" }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: "not-configured" });
    const config = await configGet();
    expect(config.status).toBe(200);
    expect(config.headers.get("cache-control")).toBe("private, no-store");
    await expect(config.json()).resolves.toEqual({ configured: false });
  });

  it("reports GIF search as configured without exposing the key", async () => {
    expect(gifSearchConfigured()).toBe(true);
    const config = await configGet();
    const body = await config.json();
    expect(body).toEqual({ configured: true });
    expect(JSON.stringify(body)).not.toContain("test-tenor-key");
    expect(JSON.stringify(body)).not.toContain("test-gif-secret");
  });

  function setCookies(res: Response): string[] {
    return res.headers.getSetCookie?.() ?? res.headers.get("set-cookie")?.split(/,(?=[^ ;]+=)/) ?? [];
  }

  function stubTenorAndGif() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("tenor.googleapis.com")) {
          return new Response(JSON.stringify(TENOR_JSON), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(GIF89A_BYTES, {
          status: 200,
          headers: {
            "content-type": "image/gif",
            "content-length": String(GIF89A_BYTES.byteLength),
          },
        });
      }),
    );
  }

  it("returns unified mobile/web results schema with signed proxy URLs and stateless fetch with Content-Length", async () => {
    stubTenorAndGif();
    const search = await searchGet(
      req("/api/gif/search?q=hi&limit=12", { "x-real-ip": "198.51.100.30" }),
    );
    expect(search.status).toBe(200);
    const payload = (await search.json()) as { results: GifProxyHit[] };
    expect(Array.isArray(payload.results)).toBe(true);
    expect(payload.results).toHaveLength(1);
    const hit = payload.results[0];
    expect(hit.id).toBe("abc");
    expect(hit.preview.w).toBe(50);
    expect(hit.preview.h).toBe(40);
    expect(hit.gif.w).toBe(100);
    expect(hit.gif.h).toBe(80);
    expect(hit.gif.bytes).toBe(2048);
    expect(hit.preview.url.startsWith("https://hypercolor.app/api/gif/fetch?")).toBe(true);
    expect(hit.gif.url.startsWith("https://hypercolor.app/api/gif/fetch?")).toBe(true);

    // Fetch without any session cookie (simulating RN Image / cross-instance serverless fetch).
    const fetched = await fetchGet(req(hit.gif.url, { "x-real-ip": "198.51.100.31" }));
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("content-type")).toBe("image/gif");
    expect(fetched.headers.get("content-length")).toBe(String(GIF89A_BYTES.byteLength));
    expect(fetched.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = new Uint8Array(await fetched.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(GIF89A_BYTES));

    // Fetch without token is refused with 403.
    const missingToken = await fetchGet(req("/api/gif/fetch?id=abc", { "x-real-ip": "198.51.100.32" }));
    expect(missingToken.status).toBe(403);
  });

  it("maps upstream Tenor 429 and 5xx errors to 429 and 502 instead of 503 not-configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    const limited = await searchGet(req("/api/gif/search?q=hi", { "x-real-ip": "198.51.100.40" }));
    expect(limited.status).toBe(429);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad gateway", { status: 500 })),
    );
    const upstreamErr = await searchGet(req("/api/gif/search?q=hi", { "x-real-ip": "198.51.100.41" }));
    expect(upstreamErr.status).toBe(502);
    const body = (await upstreamErr.json()) as { code?: string };
    expect(body.code).toBeUndefined();
  });

  it("rejects non-GIF upstream media (webp/mp4) and invalid GIF magic bytes with 502", async () => {
    const token = mintGifFetchToken({
      id: "abc",
      kind: "gif",
      url: "https://media.tenor.com/x.gif",
    })!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]), {
        status: 200,
        headers: { "content-type": "image/webp" },
      })),
    );
    const webp = await fetchGet(
      req(`/api/gif/fetch?id=abc&kind=gif&token=${encodeURIComponent(token)}`, { "x-real-ip": "198.51.100.42" }),
    );
    expect(webp.status).toBe(502);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]), {
        status: 200,
        headers: { "content-type": "image/gif" },
      })),
    );
    const badMagic = await fetchGet(
      req(`/api/gif/fetch?id=abc&kind=gif&token=${encodeURIComponent(token)}`, { "x-real-ip": "198.51.100.43" }),
    );
    expect(badMagic.status).toBe(502);
  });

  it("reissues a cookie on a forged sid and continues the request", async () => {
    stubTenorAndGif();
    const res = await searchGet(
      req("/api/gif/search?q=hi", {
        ...cookieHeader("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        "x-real-ip": "198.51.100.2",
      }),
    );
    expect(res.status).toBe(200);
    const cookies = setCookies(res);
    expect(cookies.some((c) => /hc_gif_sid=;/.test(c) && /Max-Age=0/.test(c))).toBe(true);
    expect(cookies.some((c) => /hc_gif_sid=[0-9a-f]{32}\.\d+\.[0-9a-f]{64}/i.test(c))).toBe(true);
  });

  it("reissues an expired sid and continues", async () => {
    stubTenorAndGif();
    const expired = newGifSessionId(-10);
    expect(parseGifSessionCookie(`hc_gif_sid=${expired}`).valid).toBe(false);
    const res = await searchGet(
      req("/api/gif/search?q=hi", {
        ...cookieHeader(expired),
        "x-real-ip": "198.51.100.21",
      }),
    );
    expect(res.status).toBe(200);
    expect(setCookies(res).some((c) => /hc_gif_sid=[0-9a-f]{32}\.\d+\.[0-9a-f]{64}/i.test(c))).toBe(
      true,
    );
  });

  it("does not let spoofed XFF rotate the bucket when x-real-ip is set", async () => {
    stubTenorAndGif();
    const cookie = newGifSessionId();
    let last = 200;
    for (let i = 0; i < 31; i += 1) {
      const res = await searchGet(
        req("/api/gif/search?q=hi", {
          ...cookieHeader(cookie),
          "x-real-ip": "203.0.113.9",
          "x-forwarded-for": `198.51.${i}.1, 203.0.113.9`,
        }),
      );
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("lets a select succeed after 20 previews and 429s the 31st full GIF", async () => {
    stubTenorAndGif();
    const cookie = newGifSessionId();
    const headers = { ...cookieHeader(cookie), "x-real-ip": "203.0.113.10" };
    const search = await searchGet(req("/api/gif/search?q=hi", headers));
    expect(search.status).toBe(200);
    const { results } = (await search.json()) as { results: GifProxyHit[] };
    const hit = results[0];
    for (let i = 0; i < 20; i += 1) {
      const preview = await fetchGet(req(hit.preview.url, headers));
      expect(preview.status).toBe(200);
    }
    const select = await fetchGet(req(hit.gif.url, headers));
    expect(select.status).toBe(200);
    let last = 200;
    for (let i = 0; i < 30; i += 1) {
      const res = await fetchGet(req(hit.gif.url, headers));
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("rate-limits searches through the real GET handler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(TENOR_JSON), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const cookie = newGifSessionId();
    const headers = { ...cookieHeader(cookie), "x-forwarded-for": "198.51.100.3" };
    let last = 200;
    for (let i = 0; i < 31; i += 1) {
      const res = await searchGet(req("/api/gif/search?q=hi", headers));
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("rejects host-pin failures on redirect", async () => {
    const cookie = newGifSessionId();
    const headers = { ...cookieHeader(cookie), "x-forwarded-for": "198.51.100.4" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("tenor.googleapis.com")) {
          return new Response(JSON.stringify(TENOR_JSON), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (init?.redirect === "manual" && url.includes("media.tenor.com")) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://127.0.0.1/steal.gif" },
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const search = await searchGet(req("/api/gif/search?q=hi", headers));
    expect(search.status).toBe(200);
    const { results } = (await search.json()) as { results: GifProxyHit[] };
    const fetched = await fetchGet(req(results[0].gif.url, headers));
    expect(fetched.status).toBe(404);
  });

  it("rejects oversized GIFs with 413 before buffering", async () => {
    const cookie = newGifSessionId();
    const headers = { ...cookieHeader(cookie), "x-forwarded-for": "198.51.100.5" };
    let bodyRead = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("tenor.googleapis.com")) {
          return new Response(JSON.stringify(TENOR_JSON), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            "content-type": "image/gif",
            "content-length": String(ATTACHMENT_MAX_BYTES + 1),
          }),
          get body() {
            bodyRead = true;
            return null;
          },
          arrayBuffer: async () => {
            bodyRead = true;
            return new ArrayBuffer(0);
          },
        } as unknown as Response;
      }),
    );
    const search = await searchGet(req("/api/gif/search?q=hi", headers));
    const { results } = (await search.json()) as { results: GifProxyHit[] };
    const fetched = await fetchGet(req(results[0].gif.url, headers));
    expect(fetched.status).toBe(413);
    expect(bodyRead).toBe(false);
  });

  it("preserves upstream 413 on direct and redirected media fetches", async () => {
    const token = mintGifFetchToken({
      id: "abc",
      kind: "gif",
      url: "https://media.tenor.com/x.gif",
    })!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("too large", { status: 413 })),
    );
    const direct = await fetchGet(
      req(`/api/gif/fetch?id=abc&kind=gif&token=${encodeURIComponent(token)}`, {
        "x-real-ip": "198.51.100.44",
      }),
    );
    expect(direct.status).toBe(413);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://media.tenor.com/x.gif") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://media1.tenor.com/x-big.gif" },
          });
        }
        return new Response("too large", { status: 413 });
      }),
    );
    const redirected = await fetchGet(
      req(`/api/gif/fetch?id=abc&kind=gif&token=${encodeURIComponent(token)}`, {
        "x-real-ip": "198.51.100.45",
      }),
    );
    expect(redirected.status).toBe(413);
  });
});
