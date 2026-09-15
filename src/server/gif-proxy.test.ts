import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ATTACHMENT_MAX_BYTES } from "@/flags/config";
import { allowedGifUrl, newGifSessionId, parseGifSessionCookie, stripTenorResults } from "./gif-proxy";
import { GET as searchGet } from "../../app/api/gif/search/route";
import { GET as fetchGet } from "../../app/api/gif/fetch/route";

const TENOR_JSON = {
  results: [
    {
      id: "abc",
      media_formats: {
        gif: { url: "https://media.tenor.com/x.gif", dims: [100, 80] },
        tinygif: { url: "https://media.tenor.com/x-tiny.gif", dims: [50, 40] },
      },
    },
  ],
};

function req(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, { headers });
}

function cookieHeader(value: string) {
  return { cookie: `hc_gif_sid=${value}` };
}

describe("gif proxy", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.TENOR_API_KEY = "test-tenor-key";
    process.env.GIF_PROXY_SECRET = "test-gif-secret";
  });

  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps only tenor media urls and allowlists per session", () => {
    const sid = parseGifSessionCookie(`hc_gif_sid=${newGifSessionId()}`).sid;
    const items = stripTenorResults(
      {
        results: [
          {
            id: "abc",
            media_formats: {
              gif: { url: "https://media.tenor.com/x.gif", dims: [100, 80] },
              tinygif: { url: "https://media.tenor.com/x-tiny.gif", dims: [50, 40] },
            },
            itemurl: "https://tenor.com/view/secret",
          },
          { id: "bad", media_formats: { gif: { url: "https://evil.example/x.gif" } } },
        ],
      },
      sid,
    );
    expect(items).toEqual([
      {
        id: "abc",
        previewUrl: "https://media.tenor.com/x-tiny.gif",
        gifUrl: "https://media.tenor.com/x.gif",
        width: 100,
        height: 80,
      },
    ]);
    expect(allowedGifUrl(sid, "abc")).toContain("https://media.tenor.com/x.gif");
    expect(allowedGifUrl("other-sid", "abc")).toBeNull();
  });

  it("returns 503 when Tenor is not configured", async () => {
    delete process.env.TENOR_API_KEY;
    delete process.env.GIF_PROXY_SECRET;
    const res = await searchGet(req("/api/gif/search?q=hi", { "x-forwarded-for": "198.51.100.1" }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: "not-configured" });
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
        return new Response(new Uint8Array([0x47, 0x49, 0x46]), {
          status: 200,
          headers: { "content-type": "image/gif" },
        });
      }),
    );
  }

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
    for (let i = 0; i < 20; i += 1) {
      const preview = await fetchGet(req("/api/gif/fetch?id=abc&kind=preview", headers));
      expect(preview.status).toBe(200);
    }
    const select = await fetchGet(req("/api/gif/fetch?id=abc", headers));
    expect(select.status).toBe(200);
    let last = 200;
    for (let i = 0; i < 30; i += 1) {
      const res = await fetchGet(req("/api/gif/fetch?id=abc", headers));
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
    const fetched = await fetchGet(req("/api/gif/fetch?id=abc", headers));
    expect(fetched.status).toBe(404);
  });

  it("rejects oversized GIFs before buffering", async () => {
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
    await searchGet(req("/api/gif/search?q=hi", headers));
    const fetched = await fetchGet(req("/api/gif/fetch?id=abc", headers));
    expect(fetched.status).toBe(404);
    expect(bodyRead).toBe(false);
  });
});
