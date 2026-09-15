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
import {
  findE2eHarnessHookSymbols,
  listE2eHarnessHookSymbols,
} from "./e2e-harness-symbols.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const E2E_HARNESS_MARKER = ".e2e-harness";
export const BAD_URL_ENCODING = Symbol("hypercolor.badUrlEncoding");

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
 * @returns {boolean}
 */
export function isE2eHarnessExport(root) {
  return existsSync(path.join(path.resolve(root), E2E_HARNESS_MARKER));
}

/**
 * Unmarked `NEXT_PUBLIC_E2E_HARNESS=1` exports still ship live window hooks.
 * @param {string} root
 * @returns {string[]}
 */
export function harnessHookSymbolsInExport(root) {
  const symbols = listE2eHarnessHookSymbols(REPO_ROOT);
  const hits = findE2eHarnessHookSymbols(root, symbols);
  return [...new Set(hits.map((hit) => hit.symbol))].sort();
}

function assertPreviewAllowed(root, allowE2eHarness) {
  if (allowE2eHarness) return;
  if (isE2eHarnessExport(root)) {
    throw new Error(
      `static preview: refusing to serve e2e-harness export at ${root} as production. Use --root out-e2e --allow-e2e-harness (npm run test:e2e:static), or npm run build without NEXT_PUBLIC_E2E_HARNESS.`,
    );
  }
  const symbols = harnessHookSymbolsInExport(root);
  if (symbols.length > 0) {
    throw new Error(
      `static preview: refusing to serve unmarked e2e-harness export at ${root} (found ${symbols.join(", ")}). Use --root out-e2e --allow-e2e-harness, or npm run build without NEXT_PUBLIC_E2E_HARNESS.`,
    );
  }
}

/**
 * @param {string} root
 * @param {string} urlPath
 * @returns {string | null | typeof BAD_URL_ENCODING}
 */
export function resolveOutFile(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return BAD_URL_ENCODING;
  }
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
    const rel = path.relative(rootResolved, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
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
  let allowE2eHarness = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--root") root = path.resolve(argv[++i]);
    else if (argv[i] === "--host") host = String(argv[++i]);
    else if (argv[i] === "--allow-e2e-harness") allowE2eHarness = true;
  }
  if (!Number.isFinite(port) || port < 0) {
    throw new Error(`invalid port: ${port}`);
  }
  return { port, root, host, allowE2eHarness };
}

/**
 * @param {{ root: string, port?: number, host?: string, rewrites?: { source: string, destination: string }[], allowE2eHarness?: boolean }} options
 */
export function startStaticPreview(options) {
  const root = path.resolve(options.root);
  const host = options.host ?? "127.0.0.1";
  const rewrites = options.rewrites ?? loadVercelRewrites(REPO_ROOT);
  try {
    assertPreviewAllowed(root, options.allowE2eHarness === true);
  } catch (err) {
    return Promise.reject(err);
  }
  const server = http.createServer((req, res) => {
    try {
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
      const file = resolveOutFile(root, lookup);
      if (file === BAD_URL_ENCODING) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("Bad request");
        return;
      }
      const served = file ?? resolveOutFile(root, "/404.html");
      if (!served || served === BAD_URL_ENCODING) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(served).toLowerCase();
      const type = MIME[ext] ?? "application/octet-stream";
      const status = served.endsWith(`${path.sep}404.html`) && lookup !== "/404.html" && !rewritten
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
      createReadStream(served).pipe(res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("Internal error");
      } else {
        res.destroy();
      }
    }
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
  const { port, root, host, allowE2eHarness } = parseArgs(process.argv.slice(2));
  if (!existsSync(root)) {
    console.error(`static preview: missing ${root} — run npm run build first`);
    process.exit(1);
  }
  try {
    assertPreviewAllowed(root, allowE2eHarness);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const preview = await startStaticPreview({ root, port, host, allowE2eHarness });
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
