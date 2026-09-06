import { describe, expect, it } from "vitest";
import { gifProxyLooksConfigured } from "./useGifConfigured";

describe("gifProxyLooksConfigured", () => {
  it("does not treat 401 as configured", () => {
    expect(gifProxyLooksConfigured(400)).toBe(true);
    expect(gifProxyLooksConfigured(200)).toBe(true);
    expect(gifProxyLooksConfigured(429)).toBe(true);
    expect(gifProxyLooksConfigured(401)).toBe(false);
    expect(gifProxyLooksConfigured(503)).toBe(false);
    expect(gifProxyLooksConfigured(404)).toBe(false);
  });
});
