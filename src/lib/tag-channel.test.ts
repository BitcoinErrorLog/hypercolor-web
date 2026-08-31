import { describe, expect, it } from "vitest";
import { normalizeTagLabel, parsePostKey } from "./tag-channel";

const AUTHOR = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

describe("parsePostKey", () => {
  it("splits a valid author:post_id", () => {
    expect(parsePostKey(`${AUTHOR}:abc123`)).toEqual({
      author: AUTHOR,
      postId: "abc123",
    });
  });

  it("rejects a missing colon, a non-pubky author, and path-like ids", () => {
    expect(parsePostKey("not-a-key")).toBeNull();
    expect(parsePostKey(`notapubky:post`)).toBeNull();
    expect(parsePostKey(`${AUTHOR}:../x`)).toBeNull();
    expect(parsePostKey(`${AUTHOR}:`)).toBeNull();
    expect(parsePostKey(null)).toBeNull();
  });
});

describe("normalizeTagLabel", () => {
  it("accepts ordinary topic labels", () => {
    expect(normalizeTagLabel(" rust ")).toBe("rust");
    expect(normalizeTagLabel("opensource")).toBe("opensource");
  });

  it("rejects empty, path-like, and oversized labels", () => {
    expect(normalizeTagLabel("")).toBeNull();
    expect(normalizeTagLabel("a/b")).toBeNull();
    expect(normalizeTagLabel("x?y")).toBeNull();
    expect(normalizeTagLabel("a".repeat(80))).toBeNull();
  });
});
