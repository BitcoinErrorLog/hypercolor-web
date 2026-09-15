import { describe, expect, it } from "vitest";
import { generateAuthQrDataUri } from "./auth-qr";

describe("generateAuthQrDataUri", () => {
  it("returns a PNG data URI for a pubkyauth URL", () => {
    const uri = generateAuthQrDataUri(
      "pubkyauth:///?caps=/pub/paykit/:rw&secret=abc&relay=https://httprelay.pubky.app/link",
    );
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
    expect(uri.length).toBeGreaterThan(200);
    const png = Uint8Array.from(atob(uri.slice("data:image/png;base64,".length)), (c) =>
      c.charCodeAt(0),
    );
    expect(Array.from(png.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });
});
