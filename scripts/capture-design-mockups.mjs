#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = "/tmp/hc-web/mockups";
const SURFACES = [
  "welcome",
  "chats",
  "contacts",
  "channels",
  "requests",
  "settings",
  "connect",
  "empty",
];

function serveOut(port) {
  const outRoot = path.join(ROOT, "out");
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    let filePath = path.join(outRoot, decodeURIComponent(url.pathname));
    if (url.pathname === "/" || url.pathname.endsWith("/")) {
      filePath = path.join(filePath, "index.html");
    } else if (!path.extname(filePath)) {
      filePath = `${filePath}.html`;
    }
    import("node:fs").then((fs) => {
      fs.readFile(filePath, (err, data) => {
        if (err) {
          const fallback = path.join(outRoot, "design", "index.html");
          fs.readFile(fallback, (err2, html) => {
            if (err2) {
              res.statusCode = 404;
              res.end("not found");
              return;
            }
            res.setHeader("content-type", "text/html");
            res.end(html);
          });
          return;
        }
        const ext = path.extname(filePath);
        const types = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".png": "image/png",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
          ".json": "application/json",
        };
        res.setHeader("content-type", types[ext] ?? "application/octet-stream");
        res.end(data);
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function labeledTile(file, label, width, height) {
  const bar = 36;
  const image = await sharp(file)
    .resize(width, height - bar, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const svg = Buffer.from(
    `<svg width="${width}" height="${bar}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111111"/>
      <text x="16" y="24" fill="#f9fafb" font-size="16" font-family="ui-sans-serif, system-ui">${label}</text>
    </svg>`,
  );
  return sharp({
    create: { width, height, channels: 3, background: "#05050A" },
  })
    .composite([
      { input: svg, top: 0, left: 0 },
      { input: image, top: bar, left: 0 },
    ])
    .png()
    .toBuffer();
}

async function contactSheet(tiles, cols, tileW, tileH, dest) {
  const rows = Math.ceil(tiles.length / cols);
  const composites = [];
  for (let i = 0; i < tiles.length; i += 1) {
    composites.push({
      input: tiles[i],
      left: (i % cols) * tileW,
      top: Math.floor(i / cols) * tileH,
    });
  }
  await sharp({
    create: {
      width: cols * tileW,
      height: rows * tileH,
      channels: 3,
      background: "#05050A",
    },
  })
    .composite(composites)
    .png()
    .toFile(dest);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const port = 3317;
  const server = await serveOut(port);
  const browser = await chromium.launch();
  const paths = [];
  try {
    const desktop = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      colorScheme: "dark",
      deviceScaleFactor: 1,
    });
    for (const id of SURFACES) {
      await desktop.goto(`http://127.0.0.1:${port}/design?surface=${id}`, { waitUntil: "networkidle" });
        await desktop.locator(`[data-surface="design:${id}"]`).waitFor({ state: "visible" });
        const listBox = await desktop.locator("[data-slot=master-list]").boundingBox().catch(() => null);
        console.log(`desktop ${id} list`, listBox);
        if (["chats", "contacts", "channels", "requests"].includes(id)) {
          if (!listBox || listBox.height < 200 || listBox.width < 300) {
            throw new Error(
              `desktop ${id} master-list must be ≥300×200, got ${JSON.stringify(listBox)}`,
            );
          }
        }
        const dest = path.join(OUT_DIR, `${id}-desktop.png`);
        await desktop.screenshot({ path: dest, fullPage: false });
      paths.push(dest);
    }
    await desktop.close();

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme: "dark",
      deviceScaleFactor: 2,
    });
    for (const id of SURFACES) {
      await mobile.goto(`http://127.0.0.1:${port}/design?surface=${id}`, { waitUntil: "networkidle" });
      await mobile.locator(`[data-surface="design:${id}"]`).waitFor({ state: "visible" });
      const dest = path.join(OUT_DIR, `${id}-mobile.png`);
      await mobile.screenshot({ path: dest, fullPage: false });
      paths.push(dest);
    }
    await mobile.close();

    const mixed = [];
    for (const id of SURFACES) {
      mixed.push(
        await labeledTile(path.join(OUT_DIR, `${id}-desktop.png`), `${id}-desktop`, 480, 320),
      );
      mixed.push(
        await labeledTile(path.join(OUT_DIR, `${id}-mobile.png`), `${id}-mobile`, 480, 320),
      );
    }
    await contactSheet(mixed, 4, 480, 320, path.join(OUT_DIR, "contact-sheet.png"));

    const mobileTiles = [];
    for (const id of SURFACES) {
      mobileTiles.push(
        await labeledTile(path.join(OUT_DIR, `${id}-mobile.png`), `${id}-mobile`, 960, 640),
      );
    }
    await contactSheet(mobileTiles, 2, 960, 640, path.join(OUT_DIR, "contact-sheet-mobile.png"));

    await writeFile(
      path.join(OUT_DIR, "manifest.txt"),
      `${paths.join("\n")}\n${path.join(OUT_DIR, "contact-sheet.png")}\n${path.join(OUT_DIR, "contact-sheet-mobile.png")}\n`,
    );
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
