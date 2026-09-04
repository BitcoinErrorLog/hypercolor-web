import { describe, expect, it } from "vitest";
import { avatarInitial } from "@/components/avatar-initial";

describe("avatarInitial", () => {
  it("strips Unicode format controls before taking the initial", () => {
    expect(avatarInitial("\u2068Aster Example\u2069")).toBe("A");
  });

  it("falls back when no visible initial remains", () => {
    expect(avatarInitial("\u2068\u2069")).toBe("?");
  });
});
