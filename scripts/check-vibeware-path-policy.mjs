#!/usr/bin/env node
/**
 * Fail if a changed file is outside a surface's writable_paths or matches
 * any forbidden_paths (shared + per-surface). Forbidden wins writable.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const V1_EVIDENCE_ALLOWLIST = [
  "app.route.viewed",
  "app.onboarding.state",
  "app.onboarding.abandoned",
  "app.chat.empty_state",
  "app.thread.send_settled",
  "app.request.decision",
  "app.backup.export_outcome",
  "app.error.coarse",
  "app.pwa.installed",
];

export function normalizePath(filePath) {
  return filePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/");
}

function escapeRegex(text) {
  return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function globToRegExp(pattern) {
  const normalized = normalizePath(pattern);
  let i = 0;
  let source = "^";
  while (i < normalized.length) {
    if (normalized.startsWith("**/", i)) {
      source += "(?:.*/)?";
      i += 3;
    } else if (normalized.startsWith("**", i)) {
      source += ".*";
      i += 2;
    } else if (normalized[i] === "*") {
      source += "[^/]*";
      i += 1;
    } else {
      source += escapeRegex(normalized[i]);
      i += 1;
    }
  }
  source += "$";
  return new RegExp(source);
}

export function pathMatches(pattern, filePath) {
  const file = normalizePath(filePath);
  const glob = normalizePath(pattern);
  if (file === glob) return true;
  if (glob.endsWith("/**")) {
    const prefix = glob.slice(0, -3);
    if (file === prefix || file.startsWith(`${prefix}/`)) return true;
  }
  return globToRegExp(glob).test(file);
}

export function parseYaml(text) {
  const rawLines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const lines = rawLines.map((line, index) => {
    const indent = line.match(/^ */)?.[0].length ?? 0;
    return { indent, text: line.slice(indent), index: index + 1 };
  });
  const [value, consumed] = parseBlock(lines, 0, 0);
  const next = skipBlank(lines, consumed);
  if (next < lines.length) {
    throw new Error(`yaml: unexpected content at line ${lines[next].index}`);
  }
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("yaml: document must be a mapping");
  }
  return value;
}

function skipBlank(lines, start) {
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.text === "" || line.text.startsWith("#")) {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

function parseBlock(lines, start, minIndent) {
  const i = skipBlank(lines, start);
  if (i >= lines.length) return [null, i];
  const line = lines[i];
  if (line.indent < minIndent) return [null, i];
  if (line.text.startsWith("- ")) return parseSequence(lines, i, line.indent);
  return parseMapping(lines, i, line.indent);
}

function parseMapping(lines, start, keyIndent) {
  const object = {};
  let i = start;
  while (i < lines.length) {
    i = skipBlank(lines, i);
    if (i >= lines.length) break;
    const line = lines[i];
    if (line.indent < keyIndent) break;
    if (line.indent > keyIndent) {
      throw new Error(`yaml: unexpected indent at line ${line.index}`);
    }
    if (line.text.startsWith("- ")) {
      throw new Error(`yaml: sequence item where mapping key expected at line ${line.index}`);
    }
    const colon = line.text.indexOf(":");
    if (colon < 0) {
      throw new Error(`yaml: expected key: at line ${line.index}`);
    }
    const key = line.text.slice(0, colon).trim();
    if (!key) throw new Error(`yaml: empty key at line ${line.index}`);
    const rest = line.text.slice(colon + 1).replace(/\s+#.*$/, "").trim();
    i += 1;
    if (rest !== "") {
      object[key] = parseScalar(rest, line.index);
      continue;
    }
    const next = skipBlank(lines, i);
    if (next >= lines.length || lines[next].indent <= keyIndent) {
      object[key] = null;
      continue;
    }
    const [child, after] = parseBlock(lines, next, keyIndent + 1);
    object[key] = child;
    i = after;
  }
  return [object, i];
}

function parseSequence(lines, start, dashIndent) {
  const items = [];
  let i = start;
  while (i < lines.length) {
    i = skipBlank(lines, i);
    if (i >= lines.length) break;
    const line = lines[i];
    if (line.indent < dashIndent) break;
    if (line.indent > dashIndent) {
      throw new Error(`yaml: unexpected indent at line ${line.index}`);
    }
    if (!line.text.startsWith("- ")) {
      break;
    }
    const rest = line.text.slice(2);
    const trimmed = rest.replace(/\s+#.*$/, "").trim();
    i += 1;
    const next = skipBlank(lines, i);
    const hasNested = next < lines.length && lines[next].indent > dashIndent;
    if (trimmed === "") {
      if (!hasNested) {
        items.push(null);
        continue;
      }
      const [child, after] = parseBlock(lines, next, dashIndent + 1);
      items.push(child);
      i = after;
      continue;
    }
    if (looksLikeInlineMapKey(trimmed)) {
      const colon = trimmed.indexOf(":");
      const firstKey = trimmed.slice(0, colon).trim();
      const firstRest = trimmed.slice(colon + 1).replace(/\s+#.*$/, "").trim();
      const item = {};
      if (firstRest !== "") {
        item[firstKey] = parseScalar(firstRest, line.index);
      } else if (hasNested) {
        const [child, after] = parseBlock(lines, next, dashIndent + 1);
        item[firstKey] = child;
        i = after;
      } else {
        item[firstKey] = null;
      }
      const cont = skipBlank(lines, i);
      if (cont < lines.length && lines[cont].indent > dashIndent && !lines[cont].text.startsWith("- ")) {
        const [more, after] = parseMapping(lines, cont, lines[cont].indent);
        Object.assign(item, more);
        i = after;
      }
      items.push(item);
      continue;
    }
    items.push(parseScalar(trimmed, line.index));
  }
  return [items, i];
}

function looksLikeInlineMapKey(text) {
  const colon = text.indexOf(":");
  if (colon <= 0) return false;
  const key = text.slice(0, colon);
  if (/\s/.test(key)) return false;
  if (key.includes("/")) return false;
  return true;
}

function parseScalar(raw, lineNumber) {
  if (raw === "[]") return [];
  if (raw === "{}") return {};
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  if (raw.includes(": ") && !raw.startsWith("http")) {
    throw new Error(`yaml: unsupported inline mapping at line ${lineNumber}`);
  }
  return raw;
}

function asStringList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`vibeware: ${label} must be a list of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`vibeware: ${label} is required`);
  }
  return value.trim();
}

export function loadManifest(text) {
  const doc = parseYaml(text);
  const evidenceAllowlist = asStringList(doc.evidence_allowlist, "evidence_allowlist");
  if (evidenceAllowlist.length === 0) {
    throw new Error("vibeware: evidence_allowlist must not be empty");
  }
  const sharedForbidden = asStringList(doc.forbidden_paths, "forbidden_paths");
  const rawSurfaces = doc.surfaces;
  if (!Array.isArray(rawSurfaces) || rawSurfaces.length === 0) {
    throw new Error("vibeware: surfaces must be a non-empty list");
  }
  const surfaces = rawSurfaces.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`vibeware: surfaces[${index}] must be a mapping`);
    }
    const surface = entry.surface;
    if (!surface || typeof surface !== "object") {
      throw new Error(`vibeware: surfaces[${index}].surface is required`);
    }
    const id = requireString(surface.id, `surfaces[${index}].surface.id`);
    const scope = entry.scope ?? {};
    const evidence = entry.evidence ?? {};
    const allowed = asStringList(evidence.allowed, `${id} evidence.allowed`);
    for (const eventType of allowed) {
      if (!evidenceAllowlist.includes(eventType)) {
        throw new Error(
          `vibeware: ${id} evidence.allowed contains ${eventType} which is not on evidence_allowlist`,
        );
      }
    }
    const writable = asStringList(scope.writable_paths, `${id} writable_paths`);
    if (writable.length === 0) {
      throw new Error(`vibeware: ${id} scope.writable_paths must not be empty`);
    }
    return {
      id,
      owner: requireString(surface.owner, `${id} owner`),
      risk: surface.risk,
      writable_paths: writable,
      forbidden_paths: asStringList(scope.forbidden_paths, `${id} forbidden_paths`),
      evidence_allowed: allowed,
      evidence_forbidden: asStringList(evidence.forbidden, `${id} evidence.forbidden`),
      exposure: entry.exposure ?? {},
      selection: entry.selection ?? {},
      autonomy: entry.autonomy ?? {},
      kill_switch: entry.kill_switch ?? {},
    };
  });
  const ids = surfaces.map((surface) => surface.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("vibeware: duplicate surface id");
  }
  return {
    app: doc.app ?? null,
    owner: doc.owner ?? null,
    evidence_allowlist: evidenceAllowlist,
    forbidden_paths: sharedForbidden,
    surfaces,
  };
}

export function loadManifestFile(manifestPath) {
  return loadManifest(readFileSync(manifestPath, "utf8"));
}

export function evaluateChangedFiles(manifest, surfaceId, changedFiles) {
  const surface = manifest.surfaces.find((item) => item.id === surfaceId);
  if (!surface) {
    throw new Error(`unknown surface: ${surfaceId}`);
  }
  const forbiddenPatterns = [...manifest.forbidden_paths, ...surface.forbidden_paths];
  const rejected = [];
  for (const raw of changedFiles) {
    const filePath = normalizePath(raw);
    if (!filePath) continue;
    const forbidden = forbiddenPatterns.find((pattern) => pathMatches(pattern, filePath));
    if (forbidden) {
      rejected.push({ path: filePath, reason: "forbidden", pattern: forbidden });
      continue;
    }
    const writable = surface.writable_paths.some((pattern) => pathMatches(pattern, filePath));
    if (!writable) {
      rejected.push({ path: filePath, reason: "outside_writable", pattern: null });
    }
  }
  return {
    ok: rejected.length === 0,
    surfaceId,
    rejected,
  };
}

export function readChangedFilesList(filePath) {
  const text = readFileSync(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .map(normalizePath);
}

export function changedFilesFromBase(repoRoot, baseSha) {
  const result = spawnSync("git", ["diff", "--name-only", baseSha], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `git diff --name-only ${baseSha} failed: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalizePath);
}

function usage() {
  return [
    "Usage:",
    "  ./scripts/check-vibeware-path-policy --manifest vibeware.yaml --surface <id> --changed-files <file>",
    "  ./scripts/check-vibeware-path-policy --manifest vibeware.yaml --surface <id> --base <sha>",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {
    manifest: null,
    surface: null,
    changedFiles: [],
    base: null,
    repo: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${arg}`);
      return argv[i];
    };
    switch (arg) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "--manifest":
        out.manifest = next();
        break;
      case "--surface":
        out.surface = next();
        break;
      case "--changed-files":
        out.changedFiles.push(next());
        break;
      case "--base":
        out.base = next();
        break;
      case "--repo":
        out.repo = next();
        break;
      default:
        throw new Error(`unknown argument: ${arg}\n${usage()}`);
    }
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
  if (!args.manifest || !args.surface) {
    io.stderr.write(`${usage()}\n`);
    return 2;
  }
  if (args.changedFiles.length === 0 && !args.base) {
    io.stderr.write(`${usage()}\n`);
    return 2;
  }
  try {
    const manifestPath = path.resolve(args.manifest);
    const manifest = loadManifestFile(manifestPath);
    const repoRoot = args.repo
      ? path.resolve(args.repo)
      : path.dirname(manifestPath);
    const files = [];
    for (const listPath of args.changedFiles) {
      files.push(...readChangedFilesList(path.resolve(listPath)));
    }
    if (args.base) {
      files.push(...changedFilesFromBase(repoRoot, args.base));
    }
    const result = evaluateChangedFiles(manifest, args.surface, files);
    if (!result.ok) {
      for (const item of result.rejected) {
        io.stderr.write(`${item.path}\n`);
      }
      return 1;
    }
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
