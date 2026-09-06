import { describe, expect, it } from "vitest";
import { colonTokenAt, replaceColonToken, searchEmoji } from "./dataset";

describe("emoji catalog", () => {
  it("finds :joy: at the caret", () => {
    const text = "hello :jo";
    const token = colonTokenAt(text, text.length);
    expect(token).toEqual({ start: 6, query: "jo" });
    expect(searchEmoji("jo")[0]?.id).toBe("joy");
    const next = replaceColonToken(text, text.length, "😂");
    expect(next?.text).toBe("hello 😂");
  });

  it("does not treat emails as shortcodes", () => {
    expect(colonTokenAt("a@b.com", 7)).toBeNull();
  });
});
