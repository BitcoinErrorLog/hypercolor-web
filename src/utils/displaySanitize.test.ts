import { describe, expect, it } from "vitest";
import {
  formatPaymentDisplayText,
  stripBidiAndC1,
  truncateWithEllipsis,
} from "./displaySanitize";

describe("displaySanitize", () => {
  it("strips bidi and C1 controls", () => {
    expect(stripBidiAndC1("ab\u202Ecd\u007F")).toBe("abcd");
  });

  it("strips zero-width characters and the tag block", () => {
    expect(stripBidiAndC1("ab\u200Bcd\u200Cef\u200Dgh\uFEFFij")).toBe("abcdefghij");
    expect(stripBidiAndC1(`ab${String.fromCodePoint(0xe0061)}cd`)).toBe("abcd");
  });

  it("truncates with an ellipsis", () => {
    expect(truncateWithEllipsis("abcdef", 3)).toBe("abc…");
    expect(truncateWithEllipsis("ab", 3)).toBe("ab");
  });

  it("isolates sanitized payment display text", () => {
    const out = formatPaymentDisplayText("lnbc1\u2066hidden", 8);
    expect(out.startsWith("\u2068")).toBe(true);
    expect(out.endsWith("\u2069")).toBe(true);
    expect(out.includes("\u2066")).toBe(false);
  });
});
