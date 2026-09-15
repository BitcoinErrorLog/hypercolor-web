import { describe, expect, it, vi } from "vitest";
import { NEXUS_MAX_BODY_BYTES } from "@/lib/nexus-http";
import { PUBLIC_POST_DISPLAY_MAX_CHARS } from "@/lib/public-text";
import { createNexusDiscoveryClient } from "./NexusDiscoveryClient";

const AUTHOR = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("NexusDiscoveryClient", () => {
  it("GETs /v0/tags/hot without user_id or reach", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse([{ label: "rust", tagged_count: 3, taggers_count: 2 }]),
    );
    const client = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn,
    });
    const result = await client.hotTags();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([{ label: "rust", taggedCount: 3, taggersCount: 2 }]);
    }
    const url = String(fetchFn.mock.calls[0]?.[0]);
    expect(url).toBe("https://nexus.example/v0/tags/hot?skip=0&limit=40");
    expect(fetchFn.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ referrerPolicy: "no-referrer" }),
    );
    expect(url).not.toContain("user_id");
    expect(url).not.toContain("reach");
    expect(url).not.toContain("viewer_id");
    expect(url).not.toContain("hypercolor.app");
  });

  it("degrades hot tags on network failure, malformed payload, and empty list", async () => {
    const down = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const network = await down.hotTags();
    expect(network.ok).toBe(false);
    if (!network.ok) expect(network.kind).toBe("network");

    const bad = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn: vi.fn().mockResolvedValue(jsonResponse({ not: "an-array" })),
    });
    const decode = await bad.hotTags();
    expect(decode.ok).toBe(false);
    if (!decode.ok) expect(decode.kind).toBe("decode");

    const empty = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn: vi.fn().mockResolvedValue(jsonResponse([])),
    });
    const none = await empty.hotTags();
    expect(none).toEqual({ ok: true, value: [] });
  });

  it("skips malformed hot-tag rows instead of inventing labels", async () => {
    const client = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn: vi.fn().mockResolvedValue(
        jsonResponse([
          { label: "ok", tagged_count: 1, taggers_count: 1 },
          { tagged_count: 9, taggers_count: 9 },
          "nope",
        ]),
      ),
    });
    const result = await client.hotTags();
    expect(result).toEqual({
      ok: true,
      value: [{ label: "ok", taggedCount: 1, taggersCount: 1 }],
    });
  });

  it("GETs search/posts/by_tag and drops invalid post_key rows", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse([
        { post_key: `${AUTHOR}:abc`, score: 2 },
        { post_key: "not-a-key", score: 1 },
      ]),
    );
    const client = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn,
    });
    const result = await client.searchPostsByTag("rust");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([{ author: AUTHOR, postId: "abc", score: 2 }]);
    }
    const url = String(fetchFn.mock.calls[0]?.[0]);
    expect(url).toBe("https://nexus.example/v0/search/posts/by_tag/rust?skip=0&limit=20");
    expect(url).not.toContain("viewer_id");
  });

  it("encodes the tag and username prefix in the path only", async () => {
    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([])));
    const client = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn,
    });
    await client.searchPostsByTag("c++");
    await client.searchUsersByName("Ada");
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/v0/search/posts/by_tag/c%2B%2B?");
    expect(String(fetchFn.mock.calls[1]?.[0])).toBe(
      "https://nexus.example/v0/search/users/by_name/Ada?skip=0&limit=8",
    );
    expect(String(fetchFn.mock.calls[1]?.[0])).not.toContain("viewer_id");
  });

  it("treats user search 404 as empty and rejects a non-array body", async () => {
    const missing = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn: vi.fn().mockResolvedValue(new Response("gone", { status: 404 })),
    });
    expect(await missing.searchUsersByName("zzz")).toEqual({ ok: true, value: [] });

    const bad = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn: vi.fn().mockResolvedValue(jsonResponse({ users: [PEER] })),
    });
    const decode = await bad.searchUsersByName("ada");
    expect(decode.ok).toBe(false);
    if (!decode.ok) expect(decode.kind).toBe("decode");
  });

  it("parses a post view and treats 404 as missing, not a crash", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          details: {
            content: "hello",
            id: "abc",
            author: AUTHOR,
            indexed_at: 1_700_000_000_000,
            kind: "short",
          },
        }),
      )
      .mockResolvedValueOnce(new Response("missing", { status: 404 }));
    const client = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn,
    });
    const found = await client.post(AUTHOR, "abc");
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value?.content).toBe("hello");
      expect(found.value?.author).toBe(AUTHOR);
    }
    const missing = await client.post(AUTHOR, "nope");
    expect(missing).toEqual({ ok: true, value: null });
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe(
      `https://nexus.example/v0/post/${AUTHOR}/abc`,
    );
    expect(String(fetchFn.mock.calls[0]?.[0])).not.toContain("viewer_id");
  });

  it("does not treat a post with a non-pubky author as a result", async () => {
    const client = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn: vi.fn().mockResolvedValue(
        jsonResponse({
          details: { content: "x", id: "1", author: "not-a-pubky", indexed_at: 1 },
        }),
      ),
    });
    const result = await client.post(AUTHOR, "1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("decode");
  });

  it("rejects an oversized body and slices parsed arrays to the requested limit", async () => {
    const huge = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn: vi.fn().mockResolvedValue(
        new Response("x".repeat(NEXUS_MAX_BODY_BYTES + 8), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    });
    const oversize = await huge.hotTags();
    expect(oversize.ok).toBe(false);
    if (!oversize.ok) expect(oversize.kind).toBe("decode");

    const rows = Array.from({ length: 80 }, (_, index) => ({
      label: `t${index}`,
      tagged_count: 1,
      taggers_count: 1,
    }));
    const client = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn: vi.fn().mockResolvedValue(jsonResponse(rows)),
    });
    const sliced = await client.hotTags();
    expect(sliced.ok).toBe(true);
    if (sliced.ok) expect(sliced.value).toHaveLength(40);
  });

  it("drops path-like hot-tag labels and caps post content at parse", async () => {
    const tags = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn: vi.fn().mockResolvedValue(
        jsonResponse([
          { label: "../x", tagged_count: 1, taggers_count: 1 },
          { label: "rust", tagged_count: 1, taggers_count: 1 },
        ]),
      ),
    });
    const hot = await tags.hotTags();
    expect(hot).toEqual({
      ok: true,
      value: [{ label: "rust", taggedCount: 1, taggersCount: 1 }],
    });

    const longContent = "c".repeat(PUBLIC_POST_DISPLAY_MAX_CHARS + 40);
    const posts = createNexusDiscoveryClient({
      baseUrl: "https://nexus.example",
      fetchFn: vi.fn().mockResolvedValue(
        jsonResponse({
          details: {
            content: longContent,
            id: "abc",
            author: AUTHOR,
            indexed_at: 1,
            kind: "short",
          },
        }),
      ),
    });
    const found = await posts.post(AUTHOR, "abc");
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.value?.content).toHaveLength(PUBLIC_POST_DISPLAY_MAX_CHARS);
    }
  });
});
