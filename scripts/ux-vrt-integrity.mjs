import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import pixelmatch from "pixelmatch";
import sharp from "sharp";

export const IDENTITY_THRESHOLD = 0.99;

export const IDENTITY_ALLOWLIST = new Map([
  [
    "chrome-nav-enabled::chrome-nav-needs-enable",
    "Production nav differs only by the session CTA and message-request badge in this cropped chrome capture.",
  ],
  [
    "chrome-nav-enabled::chrome-nav-no-identity",
    "Production nav differs only by the session CTA and message-request badge in this cropped chrome capture.",
  ],
]);

export function listPngs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".png") && !name.startsWith("._"))
    .map((name) => join(dir, name))
    .sort();
}

export async function readPng(path) {
  const image = sharp(readFileSync(path));
  const metadata = await image.metadata();
  const data = await image.ensureAlpha().raw().toBuffer();
  return {
    data,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}

function pixelIndex(width, x, y) {
  return (y * width + x) * 4;
}

export function cropToCommon(a, b) {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const aCommon = new Uint8Array(width * height * 4);
  const bCommon = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const out = pixelIndex(width, x, y);
      aCommon.set(a.data.subarray(pixelIndex(a.width, x, y), pixelIndex(a.width, x, y) + 4), out);
      bCommon.set(b.data.subarray(pixelIndex(b.width, x, y), pixelIndex(b.width, x, y) + 4), out);
    }
  }
  return { a: aCommon, b: bCommon, width, height };
}

export function compareImages(a, b) {
  const common = cropToCommon(a, b);
  const diff = pixelmatch(common.a, common.b, new Uint8Array(common.width * common.height * 4), common.width, common.height, {
    threshold: 0.1,
    includeAA: false,
  });
  const commonPixels = common.width * common.height;
  const sizePenalty = Math.max(a.width * a.height, b.width * b.height) - commonPixels;
  const identity = 1 - (diff + sizePenalty) / Math.max(a.width * a.height, b.width * b.height);
  return { identity, commonPixels, sizeMismatch: a.width !== b.width || a.height !== b.height };
}

export async function findNearDuplicatePngs(files, allowlist = IDENTITY_ALLOWLIST) {
  const decoded = await Promise.all(files.map(async (file) => ({ file, image: await readPng(file) })));
  const failures = [];
  for (let i = 0; i < decoded.length; i += 1) {
    for (let j = i + 1; j < decoded.length; j += 1) {
      const a = decoded[i];
      const b = decoded[j];
      const key = [basename(a.file, ".png"), basename(b.file, ".png")].sort().join("::");
      const result = compareImages(a.image, b.image);
      if (result.identity >= IDENTITY_THRESHOLD && !allowlist.has(key)) {
        failures.push(`${basename(a.file)} and ${basename(b.file)} are ${(result.identity * 100).toFixed(2)}% identical`);
      }
    }
  }
  return failures;
}
