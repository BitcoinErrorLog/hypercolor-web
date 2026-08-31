import { describe, expect, it } from "vitest";
import { pubkyAnchorParts } from "./pubky-anchors";

const PUBKY = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

describe("pubkyAnchorParts", () => {
  it("splits a 52-character pubky into bold first-8 and last-8 anchors", () => {
    const parts = pubkyAnchorParts(PUBKY);
    expect(parts.head).toBe(PUBKY.slice(0, 8));
    expect(parts.tail).toBe(PUBKY.slice(-8));
    expect(parts.mid).toBe(PUBKY.slice(8, -8));
    expect(`${parts.head}${parts.mid}${parts.tail}`).toBe(PUBKY);
    expect(parts.head).toHaveLength(8);
    expect(parts.tail).toHaveLength(8);
  });
});
