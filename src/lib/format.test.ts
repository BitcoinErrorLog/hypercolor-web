import { describe, expect, it } from "vitest";
import { formatRelativeTime, shortPubky, unreadLabel } from "./format";

const PUBKY = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

describe("format", () => {
  it("shortens a 52-character pubky", () => {
    expect(shortPubky(PUBKY)).toBe("o1ikfe…p1kq");
  });

  it("formats relative times from a fixed now", () => {
    const now = 1_700_000_000_000;
    expect(formatRelativeTime(now - 10_000, now)).toBe("now");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m");
    expect(formatRelativeTime(now - 3 * 60 * 60_000, now)).toBe("3h");
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe("2d");
  });

  it("caps unread labels", () => {
    expect(unreadLabel(0)).toBe("");
    expect(unreadLabel(7)).toBe("7");
    expect(unreadLabel(120)).toBe("99+");
  });
});
