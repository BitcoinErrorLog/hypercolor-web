import { describe, expect, it } from "vitest";
import { formatPublicKey } from "./formatPublicKey";

describe("formatPublicKey", () => {
  it("truncates to 8 chars as abcd...wxyz", () => {
    expect(
      formatPublicKey({
        key: "abcdefghijklmnopwrstuvwxyzabcdefghijklmnopwrstuvwx",
      }),
    ).toBe("abcd...uvwx");
  });

  it("uses a 52-char pubky", () => {
    const key = "o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy";
    expect(formatPublicKey({ key })).toBe("o1gg...j7dy");
  });
});
