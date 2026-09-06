import { describe, expect, it } from "vitest";
import { isSafeHttpUrl, parseInlineMarkdown } from "./render";

describe("markdown render-only", () => {
  it("parses bold italic code and https links", () => {
    const nodes = parseInlineMarkdown("**Bold** *i* `code` [x](https://example.com)");
    expect(nodes.map((n) => n.type)).toEqual(["bold", "text", "italic", "text", "code", "text", "link"]);
  });

  it("rejects javascript: and raw html", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    const nodes = parseInlineMarkdown('<img src=x onerror=alert(1)> **ok**');
    expect(nodes[0]?.type).toBe("text");
    expect(nodes.some((n) => n.type === "link")).toBe(false);
    expect(nodes.some((n) => n.type === "bold")).toBe(true);
  });
});
