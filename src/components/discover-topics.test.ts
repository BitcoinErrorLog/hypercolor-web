import { describe, expect, it, vi } from "vitest";
import {
  createDiscoverTopicsLoader,
  DISCOVER_INDEX_ERROR,
  initialDiscoverTopicsView,
} from "./discover-topics";

describe("discover topics load", () => {
  it("does not fetch until load is called", () => {
    const loadDirectory = vi.fn();
    const loader = createDiscoverTopicsLoader(loadDirectory);
    expect(loader.fetches()).toBe(0);
    expect(loadDirectory).not.toHaveBeenCalled();
    expect(initialDiscoverTopicsView()).toEqual({ tags: [], loaded: false, error: null });
  });

  it("keeps the retry path after a transient failure and loads on the next click", async () => {
    const loadDirectory = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        kind: "network",
        message: "offline",
      })
      .mockResolvedValueOnce({
        ok: true,
        tags: [{ label: "rust", taggedCount: 2, taggersCount: 1 }],
      });
    const loader = createDiscoverTopicsLoader(loadDirectory);

    const failed = await loader.load();
    expect(failed).toEqual({ tags: [], loaded: false, error: DISCOVER_INDEX_ERROR });
    expect(loader.fetches()).toBe(1);

    const retry = await loader.load();
    expect(retry).toEqual({
      tags: [{ label: "rust", taggedCount: 2, taggersCount: 1 }],
      loaded: true,
      error: null,
    });
    expect(loader.fetches()).toBe(2);
    expect(loadDirectory).toHaveBeenCalledTimes(2);
  });
});
