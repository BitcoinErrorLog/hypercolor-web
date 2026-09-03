import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const masterPath = join(repo, "design/app-icon/hypercolor-icon-master.svg");
const publicDir = join(repo, "public");
const appDir = join(repo, "app");
const canvas = "#0A0A0A";
const maskableSafeZone = 0.8;

mkdirSync(publicDir, { recursive: true });

function renderSvg(svg, size) {
  return new Resvg(svg, {
    background: canvas,
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: false },
  }).render().asPng();
}

function stripBackground(svg) {
  return svg.replace(/<rect id="icon-background"[^>]+\/>/, "");
}

async function png(path, size, svg) {
  await sharp(renderSvg(svg, size)).png().toFile(path);
}

async function maskablePng(path, size, markSvg) {
  const markSize = Math.round(size * maskableSafeZone);
  const mark = await sharp(renderSvg(markSvg, markSize)).png().toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: canvas,
    },
  })
    .composite([{ input: mark, left: Math.round((size - markSize) / 2), top: Math.round((size - markSize) / 2) }])
    .png()
    .toFile(path);
}

async function iconBounds(markSvg, size) {
  const { data, info } = await sharp(renderSvg(markSvg, size)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      if (data[i + 3] === 0) continue;
      const isCanvas = data[i] <= 12 && data[i + 1] <= 12 && data[i + 2] <= 12;
      if (isCanvas) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) throw new Error("No icon silhouette pixels found");
  return { minX, minY, maxX, maxY, width: info.width, height: info.height };
}

function assertMaskSafe(bounds) {
  const safeInset = (1 - maskableSafeZone) / 2;
  const min = Math.floor(bounds.width * safeInset);
  const max = Math.ceil(bounds.width * (1 - safeInset));
  const clipped =
    bounds.minX < min ||
    bounds.minY < min ||
    bounds.maxX > max ||
    bounds.maxY > max;
  if (clipped) {
    throw new Error(
      `Maskable safe-zone violation: ${JSON.stringify(bounds)} outside ${min}..${max}`,
    );
  }
}

async function ico(path, images) {
  const pngs = await Promise.all(images.map((size) => sharp(renderSvg(master, size)).png().toBuffer()));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  pngs.forEach((image, index) => {
    const size = images[index];
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.length;
  });
  writeFileSync(path, Buffer.concat([header, ...entries, ...pngs]));
}

const master = readFileSync(masterPath, "utf8");
const markOnly = stripBackground(master);

await png(join(publicDir, "icon-192.png"), 192, master);
await png(join(publicDir, "icon-512.png"), 512, master);
await png(join(publicDir, "apple-touch-icon.png"), 180, master);
await maskablePng(join(publicDir, "icon-maskable-192.png"), 192, markOnly);
await maskablePng(join(publicDir, "icon-maskable-512.png"), 512, markOnly);
writeFileSync(join(publicDir, "icon.svg"), master.replace(/width="1024" height="1024"/, 'width="512" height="512"'));
writeFileSync(join(publicDir, "favicon.svg"), master.replace(/width="1024" height="1024"/, 'width="512" height="512"'));
await ico(join(appDir, "favicon.ico"), [16, 32, 48]);

assertMaskSafe(await iconBounds(markOnly, 1024));

console.log("Generated web icons from design/app-icon/hypercolor-icon-master.svg");
console.log("Mask verification: silhouette remains inside the 80% maskable safe zone");
