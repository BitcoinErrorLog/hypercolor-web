import { describe, expect, it } from "vitest";
import { canonicalPubkyUri, parsePubkyPayload } from "./pubkyPayload";

const valid = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const invalidCharset = "o0ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

describe("parsePubkyPayload", () => {
  it.each([
    ["bare z32", valid, valid],
    ["pubky:// URI", `pubky://${valid}`, valid],
    ["PUBKY:// uppercase scheme", `PUBKY://${valid}`, valid],
    ["pubky:// with path", `pubky://${valid}/pub/paykit/`, valid],
    ["concatenated pubky + z32", `pubky${valid}`, valid],
    ["concatenated with path", `pubky${valid}/profile`, valid],
    ["https profile path", `https://pubky.app/profile/${valid}`, valid],
    ["https root path", `https://pubky.app/${valid}`, valid],
    ["https www + trailing path", `https://www.pubky.app/profile/${valid}/posts`, valid],
    ["http profile URL", `http://pubky.app/${valid}`, valid],
  ] as const)("accepts %s", (_label, input, expected) => {
    expect(parsePubkyPayload(input)).toBe(expected);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["short", "short"],
    ["charset 0", invalidCharset],
    ["charset 2/l/v", "2lvkfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq"],
    ["other host", `https://example.com/${valid}`],
    ["username", "aster"],
  ] as const)("rejects %s", (_label, input) => {
    expect(parsePubkyPayload(input)).toBeNull();
  });

  it("formats the canonical QR payload", () => {
    expect(canonicalPubkyUri(valid)).toBe(`pubky://${valid}`);
  });
});
