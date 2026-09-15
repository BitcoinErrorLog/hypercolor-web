const RASTER = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

export function isRasterImageContentType(contentType: string): boolean {
  const base = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  return RASTER.has(base);
}
