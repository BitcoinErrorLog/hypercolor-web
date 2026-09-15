import { describe, expect, it } from "vitest";
import { sanitizePublicPost, sanitizePublicTag } from "./public-text";

describe("sanitizePublicText", () => {
  it("strips bidi controls and isolates the result", () => {
    const out = sanitizePublicPost("hi\u202Esecret");
    expect(out.startsWith("\u2068")).toBe(true);
    expect(out.endsWith("\u2069")).toBe(true);
    expect(out).not.toContain("\u202E");
  });

  it("truncates a long tag", () => {
    const out = sanitizePublicTag("a".repeat(80));
    expect(out).toContain("…");
  });
});
