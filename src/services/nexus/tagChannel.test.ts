import { describe, expect, it, vi } from "vitest";
import { createTagChannelReader } from "./tagChannel";
import type { NexusDiscoveryApi } from "./NexusDiscoveryClient";

const AUTHOR = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

function api(partial: Partial<NexusDiscoveryApi>): NexusDiscoveryApi {
  return {
    hotTags: vi.fn(),
    searchPostsByTag: vi.fn(),
    post: vi.fn(),
    searchUsersByName: vi.fn(),
    ...partial,
  };
}

describe("tagChannel reader", () => {
  it("loads the global hot-tag directory", async () => {
    const hotTags = vi.fn().mockResolvedValue({
      ok: true,
      value: [{ label: "rust", taggedCount: 2, taggersCount: 1 }],
    });
    const result = await createTagChannelReader(api({ hotTags })).loadDirectory();
    expect(result).toEqual({
      ok: true,
      tags: [{ label: "rust", taggedCount: 2, taggersCount: 1 }],
    });
    expect(hotTags).toHaveBeenCalledOnce();
  });

  it("degrades directory load when Nexus is down or empty", async () => {
    const down = await createTagChannelReader(
      api({
        hotTags: vi.fn().mockResolvedValue({
          ok: false,
          kind: "network",
          status: null,
          message: "offline",
        }),
      }),
    ).loadDirectory();
    expect(down.ok).toBe(false);

    const empty = await createTagChannelReader(
      api({ hotTags: vi.fn().mockResolvedValue({ ok: true, value: [] }) }),
    ).loadDirectory();
    expect(empty).toEqual({ ok: true, tags: [] });
  });

  it("hydrates a timeline and skips missing posts", async () => {
    const reader = createTagChannelReader(
      api({
        searchPostsByTag: vi.fn().mockResolvedValue({
          ok: true,
          value: [
            { author: AUTHOR, postId: "a", score: 1 },
            { author: AUTHOR, postId: "b", score: 1 },
          ],
        }),
        post: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            value: {
              author: AUTHOR,
              postId: "a",
              content: "hello",
              indexedAt: 1,
              kind: "short",
            },
          })
          .mockResolvedValueOnce({ ok: true, value: null }),
      }),
    );
    const result = await reader.loadTimeline(" rust ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tag).toBe("rust");
      expect(result.posts).toHaveLength(1);
      expect(result.unavailable).toBe(1);
    }
  });

  it("rejects an invalid tag before calling Nexus", async () => {
    const searchPostsByTag = vi.fn();
    const result = await createTagChannelReader(api({ searchPostsByTag })).loadTimeline("../x");
    expect(result).toEqual({
      ok: false,
      kind: "invalid",
      message: "That is not a usable topic label.",
    });
    expect(searchPostsByTag).not.toHaveBeenCalled();
  });

  it("does not hydrate more post keys than the client-side timeline cap", async () => {
    const keys = Array.from({ length: 40 }, (_, index) => ({
      author: AUTHOR,
      postId: `p${index}`,
      score: 1,
    }));
    const post = vi.fn().mockResolvedValue({ ok: true, value: null });
    await createTagChannelReader(
      api({
        searchPostsByTag: vi.fn().mockResolvedValue({ ok: true, value: keys }),
        post,
      }),
    ).loadTimeline("rust");
    expect(post).toHaveBeenCalledTimes(20);
  });
});
