import { describe, expect, it } from "vitest";
import { mapPool } from "./map-pool";

describe("mapPool", () => {
  it("preserves order with bounded concurrency", async () => {
    const seen: number[] = [];
    const out = await mapPool([3, 1, 2], 2, async (n) => {
      seen.push(n);
      await new Promise((resolve) => setTimeout(resolve, n));
      return n * 10;
    });
    expect(out).toEqual([30, 10, 20]);
    expect(seen).toHaveLength(3);
  });

  it("returns empty for an empty list", async () => {
    expect(await mapPool([], 4, async (n: number) => n)).toEqual([]);
  });
});
