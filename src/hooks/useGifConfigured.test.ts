import { describe, expect, it } from "vitest";
import { gifConfigSaysConfigured } from "./useGifConfigured";

describe("gifConfigSaysConfigured", () => {
  it("accepts only an explicit configured true", () => {
    expect(gifConfigSaysConfigured({ configured: true })).toBe(true);
    expect(gifConfigSaysConfigured({ configured: false })).toBe(false);
    expect(gifConfigSaysConfigured({ configured: "true" })).toBe(false);
    expect(gifConfigSaysConfigured({})).toBe(false);
    expect(gifConfigSaysConfigured(null)).toBe(false);
    expect(gifConfigSaysConfigured("configured")).toBe(false);
  });
});
