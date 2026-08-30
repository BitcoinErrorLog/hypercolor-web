import { describe, expect, it } from "vitest";
import { isRasterImageContentType } from "./attachment-preview";

describe("isRasterImageContentType", () => {
  it("allows raster types only", () => {
    expect(isRasterImageContentType("image/png")).toBe(true);
    expect(isRasterImageContentType("image/jpeg; charset=binary")).toBe(true);
    expect(isRasterImageContentType("image/gif")).toBe(true);
    expect(isRasterImageContentType("image/webp")).toBe(true);
    expect(isRasterImageContentType("image/svg+xml")).toBe(false);
    expect(isRasterImageContentType("application/pdf")).toBe(false);
  });
});
