/**
 * Static-export preview with the same SPA rewrites Vercel applies
 * (vercel.json): /chats/:id, /channels/:id, /contacts/:id.
 *
 * Plain `npx serve out` 404s `/chats/dm:<pubky>`, so the Ring gate cannot
 * open a thread against a local preview.
 *
 *   PREVIEW_ROOT=/tmp/hc-swfix/out PORT=3011 node e2e/support/serve-static-preview.mjs
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(process.env.PREVIEW_ROOT ?? join(process.cwd(), "out"));
const PORT = Number(process.env.PORT ?? 3011);

function mime(file) {
  switch (extname(file)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".json":
      return "application/json";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function rewrite(pathname) {
  const rules = [
    [/^\/chats\/.+\.txt$/, "/chats.txt"],
    [/^\/chats\/.+/, "/chats.html"],
    [/^\/channels\/.+\.txt$/, "/channels.txt"],
    [/^\/channels\/.+/, "/channels.html"],
    [/^\/contacts\/.+\.txt$/, "/contacts.txt"],
    [/^\/contacts\/.+/, "/contacts.html"],
  ];
  for (const [pattern, dest] of rules) {
    if (pattern.test(pathname)) return dest;
  }
  return pathname === "/" ? "/index.html" : pathname;
}

function resolveFile(pathname) {
  const rel = rewrite(pathname);
  const candidates = [join(ROOT, rel), join(ROOT, `${rel}.html`), join(ROOT, rel, "index.html")];
  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    if (!normalized.startsWith(ROOT)) continue;
    if (existsSync(normalized) && statSync(normalized).isFile()) return normalized;
  }
  return null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const file = resolveFile(decodeURIComponent(url.pathname));
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": mime(file) });
  createReadStream(file).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.info(`preview ${ROOT} on http://127.0.0.1:${PORT}`);
});
