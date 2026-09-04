import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import pixelmatch from "pixelmatch";
import sharp from "sharp";

export const IDENTITY_THRESHOLD = 0.99;

export const IDENTITY_ALLOWLIST = new Map([
  [
    "channel-editing::channel-populated",
    "Both capture the same production channel thread; the reviewed difference is the edit-mode composer draft.",
  ],
  [
    "channels-private-busy::channels-private-empty",
    "Both capture the same production create-group form; the reviewed difference is the busy create state with selected members.",
  ],
  [
    "channels-public-error::channels-public-initial",
    "Both capture the same production public-topics panel; the reviewed difference is the retry/error copy.",
  ],
  [
    "channels-public-error::channels-public-populated",
    "Both capture the same production public-topics panel; the reviewed difference is the error copy replacing topic rows.",
  ],
  [
    "chrome-nav-enabled::chrome-nav-needs-enable",
    "Both capture the real production navigation; the reviewed difference is the session-enabled request badge count.",
  ],
  [
    "public-topic-empty::public-topic-loading",
    "Both capture the same production public-topic reader; the reviewed difference is the loading status line.",
  ],
  [
    "public-topic-empty::public-topic-unavailable",
    "Both capture the same production public-topic reader; the reviewed difference is the unavailable-row status line.",
  ],
  [
    "public-topic-error::public-topic-loading",
    "Both capture the same production public-topic reader; the reviewed difference is error versus loading status copy.",
  ],
  [
    "public-topic-error::public-topic-unavailable",
    "Both capture the same production public-topic reader; the reviewed difference is error versus unavailable-row status copy.",
  ],
  [
    "public-topic-loading::public-topic-unavailable",
    "Both capture the same production public-topic reader; the reviewed difference is loading versus unavailable-row status copy.",
  ],
  [
    "thread-empty::thread-loading",
    "Both capture the same empty production thread shell; the reviewed difference is empty-state copy versus loading copy.",
  ],
  [
    "thread-payment-expired::thread-payment-notice",
    "Both capture the same production payment request bubble; the reviewed difference is requested versus expired status copy.",
  ],
  [
    "thread-payment-failed::thread-payment-proof",
    "Both capture the same production read-only payment bubble; the reviewed difference is payment proof versus failed status copy.",
  ],
  [
    "thread-payment-failed::thread-payment-unverified",
    "Both capture the same production read-only payment bubble; the reviewed difference is failed versus unverified status copy.",
  ],
  [
    "thread-payment-proof::thread-payment-unverified",
    "Both capture the same production read-only payment bubble; the reviewed difference is payment proof versus unverified status copy.",
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

function samePixel(data, a, b) {
  return (
    data[a] === data[b] &&
    data[a + 1] === data[b + 1] &&
    data[a + 2] === data[b + 2] &&
    data[a + 3] === data[b + 3]
  );
}

function trimBackground(image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = pixelIndex(image.width, x, y);
      if (samePixel(image.data, 0, offset)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return image;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const out = pixelIndex(width, x, y);
      const source = pixelIndex(image.width, minX + x, minY + y);
      data.set(image.data.subarray(source, source + 4), out);
    }
  }
  return { data, width, height };
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
    threshold: 0.01,
    includeAA: false,
  });
  const commonPixels = common.width * common.height;
  const sizePenalty = Math.max(a.width * a.height, b.width * b.height) - commonPixels;
  const identity = 1 - (diff + sizePenalty) / Math.max(a.width * a.height, b.width * b.height);
  return { identity, commonPixels, sizeMismatch: a.width !== b.width || a.height !== b.height };
}

export async function findNearDuplicatePngs(files, allowlist = IDENTITY_ALLOWLIST) {
  const decoded = await Promise.all(files.map(async (file) => ({ file, image: trimBackground(await readPng(file)) })));
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
