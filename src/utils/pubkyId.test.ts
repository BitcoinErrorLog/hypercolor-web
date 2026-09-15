import { describe, expect, it } from "vitest";
import { isValidPubky, normalizePubkyInput, parsePubky } from "./pubkyId";

const valid =
  "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

describe("pubkyId", () => {
  it("normalizes a pubky:// URI to the z-base-32 key", () => {
    expect(normalizePubkyInput(`pubky://${valid}/pub/paykit/`)).toBe(valid);
  });

  it("accepts a 52-character z-base-32 pubky", () => {
    expect(isValidPubky(valid)).toBe(true);
    expect(parsePubky(`PUBKY://${valid}`)).toBe(valid);
  });

  it("rejects the wrong length or charset", () => {
    expect(isValidPubky("short")).toBe(false);
    expect(isValidPubky("0".repeat(52))).toBe(false);
    expect(parsePubky("not-a-pubky")).toBeNull();
  });
});
