import { describe, expect, it } from "vitest";
import { moveRovingIndex } from "./focus-trap";

describe("moveRovingIndex", () => {
  it("wraps arrow keys and jumps to the ends", () => {
    expect(moveRovingIndex(0, "ArrowDown", 3)).toBe(1);
    expect(moveRovingIndex(2, "ArrowDown", 3)).toBe(0);
    expect(moveRovingIndex(0, "ArrowUp", 3)).toBe(2);
    expect(moveRovingIndex(1, "Home", 3)).toBe(0);
    expect(moveRovingIndex(1, "End", 3)).toBe(2);
    expect(moveRovingIndex(0, "ArrowDown", 0)).toBe(0);
  });
});
