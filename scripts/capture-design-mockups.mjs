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
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const port = 3317;
  const server = await serveOut(port);
  const browser = await chromium.launch();
  const paths = [];
  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: "dark",
      });
      for (const id of SURFACES) {
        await page.goto(`http://127.0.0.1:${port}/design?surface=${id}`, {
          waitUntil: "networkidle",
        });
        const target = page.locator(`[data-surface="design:${id}"]`);
        await target.waitFor({ state: "visible" });
        const dest = path.join(OUT_DIR, `${id}-${vp.name}.png`);
        await page.screenshot({ path: dest, fullPage: false });
        paths.push(dest);
      }
      await page.close();
    }

    const tiles = [];
    for (const id of SURFACES) {
      for (const vp of VIEWPORTS) {
        tiles.push(path.join(OUT_DIR, `${id}-${vp.name}.png`));
      }
    }
    const resized = await Promise.all(
      tiles.map((file) => sharp(file).resize(360, 225, { fit: "cover" }).png().toBuffer()),
    );
    const cols = 4;
    const rows = 4;
    const composites = resized.map((input, i) => ({
      input,
      left: (i % cols) * 360,
      top: Math.floor(i / cols) * 225,
    }));
    await sharp({
      create: {
        width: cols * 360,
        height: rows * 225,
        channels: 3,
        background: "#05050A",
      },
    })
      .composite(composites)
      .png()
      .toFile(path.join(OUT_DIR, "contact-sheet.png"));
    await writeFile(path.join(OUT_DIR, "manifest.txt"), `${paths.join("\n")}\n${path.join(OUT_DIR, "contact-sheet.png")}\n`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
