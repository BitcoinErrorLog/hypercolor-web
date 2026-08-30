#!/usr/bin/env node
/**
 * Every file listed in any surface writable_paths must not:
 * - import a path that matches any forbidden_paths entry
 * - import src/services/vibeware/** (collector)
 * - mention fetch / navigator.sendBeacon / XMLHttpRequest / WebSocket
 *
 * Mechanical: specifier scan + banned identifiers. `src/types/**` imports
 * are waived (see docs/vibeware.md).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadManifestFile,
  pathMatches,
  UnsafePathError,
} from "./check-vibeware-path-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "vibeware.yaml");
const BANNED_IDENTIFIERS = /\b(fetch|sendBeacon|XMLHttpRequest|WebSocket)\b/;
const IMPORT_RE =
  /(?:import\s+(?:type\s+)?[\s\S]*?from\s*|import\s+|export\s+[\s\S]*?from\s*|import\s*\(\s*)["']([^"']+)["']/g;

function walkFiles(relDir, acc = []) {
  const abs = path.join(ROOT, relDir);
  if (!existsSync(abs)) return acc;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = path.posix.join(relDir.replace(/\\/g, "/"), entry.name);
    if (entry.isDirectory()) {
      walkFiles(rel, acc);
    } else {
      acc.push(rel);
    }
  }
  return acc;
}

function expandWritable(pattern) {
  const normalized = pattern.replace(/\\/g, "/");
  if (!normalized.includes("*")) {
    return existsSync(path.join(ROOT, normalized)) ? [normalized] : [normalized];
  }
  const all = walkFiles(".");
  return all.filter((filePath) => {
    try {
      return pathMatches(normalized, filePath);
    } catch (error) {
      if (error instanceof UnsafePathError) return false;
      throw error;
    }
  });
}

function tryResolve(rel) {
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
    if (existsSync(path.join(ROOT, candidate))) return candidate;
  }
  return unified;
}

export function resolveSpecifier(fromFile, specifier) {
  if (specifier.startsWith("@/")) {
    return tryResolve(`src/${specifier.slice(2)}`);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const fromDir = path.posix.dirname(fromFile.replace(/\\/g, "/"));
    return tryResolve(path.posix.normalize(`${fromDir}/${specifier}`));
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

export function scanWritableFile(source, fromFile, forbiddenPatterns) {
  const findings = [];
  if (BANNED_IDENTIFIERS.test(source)) {
    findings.push({
      path: fromFile,
      reason: "banned_identifier",
      detail: "fetch/sendBeacon/XMLHttpRequest/WebSocket",
    });
  }
  IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = IMPORT_RE.exec(source))) {
    const specifier = match[1];
    if (specifier.includes("services/vibeware/") || specifier.includes("src/services/vibeware/")) {
      findings.push({ path: fromFile, reason: "collector_import", detail: specifier });
      continue;
    }
    const resolved = resolveSpecifier(fromFile, specifier);
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

export function checkWritableImports(manifest = loadManifestFile(MANIFEST)) {
  const forbiddenPatterns = [
    ...manifest.forbidden_paths,
    ...manifest.surfaces.flatMap((surface) => surface.forbidden_paths),
    "src/services/vibeware/**",
  ];
  const writable = new Set();
  for (const surface of manifest.surfaces) {
    for (const pattern of surface.writable_paths) {
      for (const filePath of expandWritable(pattern)) {
        writable.add(filePath);
      }
    }
  }
  const findings = [];
  for (const filePath of writable) {
    const abs = path.join(ROOT, filePath);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      findings.push({ path: filePath, reason: "missing_writable", detail: "listed writable path is not a file" });
      continue;
    }
    const source = readFileSync(abs, "utf8");
    findings.push(...scanWritableFile(source, filePath, forbiddenPatterns));
  }
  return { ok: findings.length === 0, findings };
}

export function main(io = process) {
  try {
    const result = checkWritableImports();
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
