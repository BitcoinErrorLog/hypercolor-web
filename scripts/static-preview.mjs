#!/usr/bin/env node
/**
 * Serve `out/` the way Vercel does for this static export: apply `vercel.json`
 * rewrites so nested client routes (`/chats/:id`, `/contacts/:pubky`, …) return
 * the list HTML instead of 404.
 */
import http from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/**
 * @param {string} pathname
 * @param {{ source: string, destination: string }[]} rewrites
 * @returns {string | null}
 */
export function matchRewrite(pathname, rewrites) {
  const pathOnly = pathname.split("?")[0];
  const pathParts = pathOnly.split("/").filter(Boolean);
  for (const rule of rewrites) {
    const srcParts = rule.source.split("/").filter(Boolean);
    if (srcParts.length !== pathParts.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < srcParts.length; i += 1) {
      if (srcParts[i].startsWith(":")) {
        params[srcParts[i].slice(1)] = pathParts[i];
        continue;
      }
      if (srcParts[i] !== pathParts[i]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    return rule.destination.replace(/:([A-Za-z0-9_]+)/g, (_, name) => params[name] ?? "");
  }
  return null;
}

/**
 * @param {string} repoRoot
 * @returns {{ source: string, destination: string }[]}
 */
export function loadVercelRewrites(repoRoot = REPO_ROOT) {
  const raw = JSON.parse(readFileSync(path.join(repoRoot, "vercel.json"), "utf8"));
  return Array.isArray(raw.rewrites) ? raw.rewrites : [];
}

/**
 * @param {string} root
 * @param {string} urlPath
 * @returns {string | null}
 */
export function resolveOutFile(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.posix.normalize(decoded);
  if (normalized.includes("\0") || normalized.startsWith("..") || normalized.includes("/../")) {
    return null;
  }
  const rootResolved = path.resolve(root);
  const candidates = [];
  if (normalized === "/" || normalized === "") {
    candidates.push(path.join(rootResolved, "index.html"));
  } else {
    const rel = normalized.replace(/^\/+/, "");
    candidates.push(path.join(rootResolved, rel));
    candidates.push(path.join(rootResolved, `${rel}.html`));
    candidates.push(path.join(rootResolved, rel, "index.html"));
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(rootResolved)) continue;
    if (!existsSync(resolved)) continue;
    const stat = statSync(resolved);
    if (stat.isFile()) return resolved;
  }
  return null;
}

function parseArgs(argv) {
  let port = Number(process.env.PORT || 3000);
  let root = path.join(REPO_ROOT, "out");
  let host = process.env.HOST || "127.0.0.1";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--root") root = path.resolve(argv[++i]);
    else if (argv[i] === "--host") host = String(argv[++i]);
  }
  if (!Number.isFinite(port) || port < 0) {
    throw new Error(`invalid port: ${port}`);
  }
  return { port, root, host };
}

/**
 * @param {{ root: string, port?: number, host?: string, rewrites?: { source: string, destination: string }[] }} options
 */
export function startStaticPreview(options) {
  const root = path.resolve(options.root);
  const host = options.host ?? "127.0.0.1";
  const rewrites = options.rewrites ?? loadVercelRewrites(REPO_ROOT);
  const server = http.createServer((req, res) => {
    const incoming = req.url ?? "/";
    let pathname;
    try {
      pathname = new URL(incoming, "http://127.0.0.1").pathname;
    } catch {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Bad request");
      return;
    }
    const rewritten = matchRewrite(pathname, rewrites);
    const lookup = rewritten ?? pathname;
    const file = resolveOutFile(root, lookup) ?? resolveOutFile(root, "/404.html");
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    const status = file.endsWith(`${path.sep}404.html`) && lookup !== "/404.html" && !rewritten
      ? 404
      : 200;
    res.writeHead(status, {
      "content-type": type,
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=0",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port ?? 0;
      resolve({
        url: `http://${host}:${port}`,
        port,
        host,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    });
  });
}

async function main() {
  const { port, root, host } = parseArgs(process.argv.slice(2));
  if (!existsSync(root)) {
    console.error(`static preview: missing ${root} — run npm run build first`);
    process.exit(1);
  }
  const preview = await startStaticPreview({ root, port, host });
  const rules = loadVercelRewrites(REPO_ROOT)
    .map((rule) => `${rule.source} → ${rule.destination}`)
    .join(", ");
  console.log(`static preview: ${preview.url}`);
  console.log(`rewrites: ${rules}`);
}

const isMain =
  process.argv[1] !== undefined &&
  path.normalize(fileURLToPath(import.meta.url)) ===
    path.normalize(path.resolve(process.argv[1]));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
