#!/usr/bin/env node
/**
 * Every file listed in any surface writable_paths must not:
 * - import a path that matches any forbidden_paths entry
 * - import src/services/vibeware/** (collector)
 * - mention fetch / navigator.sendBeacon / XMLHttpRequest / WebSocket
 *
 * Mechanical: specifier scan + banned identifiers. Matches static
 * import/export, `require("...")` / `require('...')`, and `import(...)`
 * with comments or whitespace inside the parentheses. `src/types/**`
 * imports are waived (see docs/vibeware.md).
 *
 * Manifest and scanner code come from this script's tree (base, when CI
 * invokes the extracted copy). `--repo` selects which workspace to walk.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadManifestFile,
  pathMatches,
  UnsafePathError,
} from "./check-vibeware-path-policy.mjs";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(SCRIPT_ROOT, "vibeware.yaml");
const BANNED_IDENTIFIERS = /\b(fetch|sendBeacon|XMLHttpRequest|WebSocket)\b/;
const STATIC_IMPORT_RE =
  /(?:import\s+(?:type\s+)?[\s\S]*?from\s*|export\s+[\s\S]*?from\s*|import\s+)["']([^"']+)["']/g;
const CALL_IMPORT_RE = /\b(?:require|import)\s*\(/g;

function walkFiles(repoRoot, relDir, acc = []) {
  const abs = path.join(repoRoot, relDir);
  if (!existsSync(abs)) return acc;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = path.posix.join(relDir.replace(/\\/g, "/"), entry.name);
    if (entry.isDirectory()) {
      walkFiles(repoRoot, rel, acc);
    } else {
      acc.push(rel);
    }
  }
  return acc;
}

function expandWritable(repoRoot, pattern) {
  const normalized = pattern.replace(/\\/g, "/");
  if (!normalized.includes("*")) {
    return existsSync(path.join(repoRoot, normalized)) ? [normalized] : [normalized];
  }
  const all = walkFiles(repoRoot, ".");
  return all.filter((filePath) => {
    try {
      return pathMatches(normalized, filePath);
    } catch (error) {
      if (error instanceof UnsafePathError) return false;
      throw error;
    }
  });
}

function tryResolve(repoRoot, rel) {
  const unified = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  const candidates = [
    unified,
    `${unified}.ts`,
    `${unified}.tsx`,
    `${unified}.mjs`,
    `${unified}.js`,
    `${unified}/index.ts`,
    `${unified}/index.tsx`,
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(repoRoot, candidate))) return candidate;
  }
  return unified;
}

export function skipWsAndComments(source, start) {
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f") {
      i += 1;
      continue;
    }
    if (source.startsWith("//", i)) {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function readQuotedSpecifier(source, start) {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return null;
  let i = start + 1;
  let value = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      value += source[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (ch === quote) {
      return { specifier: value, next: i + 1 };
    }
    value += ch;
    i += 1;
  }
  return null;
}

export function collectImportSpecifiers(source) {
  const specifiers = [];
  STATIC_IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = STATIC_IMPORT_RE.exec(source))) {
    specifiers.push(match[1]);
  }
  CALL_IMPORT_RE.lastIndex = 0;
  while ((match = CALL_IMPORT_RE.exec(source))) {
    const afterOpen = skipWsAndComments(source, match.index + match[0].length);
    const quoted = readQuotedSpecifier(source, afterOpen);
    if (quoted) specifiers.push(quoted.specifier);
  }
  return specifiers;
}

export function resolveSpecifier(fromFile, specifier, repoRoot = SCRIPT_ROOT) {
  if (specifier.startsWith("@/")) {
    return tryResolve(repoRoot, `src/${specifier.slice(2)}`);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const fromDir = path.posix.dirname(fromFile.replace(/\\/g, "/"));
    return tryResolve(repoRoot, path.posix.normalize(`${fromDir}/${specifier}`));
  }
  return null;
}

function isTypesWaiver(resolved) {
  try {
    return pathMatches("src/types/**", resolved);
  } catch {
    return false;
  }
}

export function scanWritableFile(source, fromFile, forbiddenPatterns, repoRoot = SCRIPT_ROOT) {
  const findings = [];
  if (BANNED_IDENTIFIERS.test(source)) {
    findings.push({
      path: fromFile,
      reason: "banned_identifier",
      detail: "fetch/sendBeacon/XMLHttpRequest/WebSocket",
    });
  }
  for (const specifier of collectImportSpecifiers(source)) {
    if (specifier.includes("services/vibeware/") || specifier.includes("src/services/vibeware/")) {
      findings.push({ path: fromFile, reason: "collector_import", detail: specifier });
      continue;
    }
    const resolved = resolveSpecifier(fromFile, specifier, repoRoot);
    if (!resolved) continue;
    if (isTypesWaiver(resolved)) continue;
    const hit = forbiddenPatterns.find((pattern) => {
      try {
        return pathMatches(pattern, resolved);
      } catch {
        return false;
      }
    });
    if (hit) {
      findings.push({
        path: fromFile,
        reason: "forbidden_import",
        detail: `${specifier} -> ${resolved} (${hit})`,
      });
    }
  }
  return findings;
}

export function checkWritableImports(manifest, options = {}) {
  const repoRoot = options.repoRoot ?? SCRIPT_ROOT;
  const resolvedManifest = manifest ?? loadManifestFile(MANIFEST);
  const forbiddenPatterns = [
    ...resolvedManifest.forbidden_paths,
    ...resolvedManifest.surfaces.flatMap((surface) => surface.forbidden_paths),
    "src/services/vibeware/**",
  ];
  const writable = new Set();
  for (const surface of resolvedManifest.surfaces) {
    for (const pattern of surface.writable_paths) {
      for (const filePath of expandWritable(repoRoot, pattern)) {
        writable.add(filePath);
      }
    }
  }
  const findings = [];
  for (const filePath of writable) {
    const abs = path.join(repoRoot, filePath);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      findings.push({ path: filePath, reason: "missing_writable", detail: "listed writable path is not a file" });
      continue;
    }
    const source = readFileSync(abs, "utf8");
    findings.push(...scanWritableFile(source, filePath, forbiddenPatterns, repoRoot));
  }
  return { ok: findings.length === 0, findings };
}

function usage() {
  return "Usage: node scripts/check-vibeware-writable-imports.mjs [--repo <dir>]";
}

function parseArgs(argv) {
  const out = { repo: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      out.help = true;
      continue;
    }
    if (arg === "--repo") {
      i += 1;
      if (i >= argv.length) throw new Error("missing value for --repo");
      out.repo = argv[i];
      continue;
    }
    throw new Error(`unknown argument: ${arg}\n${usage()}`);
  }
  return out;
}

export function main(argv = process.argv.slice(2), io = process) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    return 2;
  }
  if (args.help) {
    io.stdout.write(`${usage()}\n`);
    return 0;
  }
  const repoRoot = args.repo ? path.resolve(args.repo) : SCRIPT_ROOT;
  try {
    const result = checkWritableImports(undefined, { repoRoot });
    if (!result.ok) {
      for (const item of result.findings) {
        io.stderr.write(`${item.path}\t${item.reason}\t${item.detail || ""}\n`);
      }
      return 1;
    }
    io.stdout.write("writable-import check passed\n");
    return 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = main();
}
