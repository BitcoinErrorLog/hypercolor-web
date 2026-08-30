#!/usr/bin/env node
/**
 * Fail if a changed file is outside a surface's writable_paths or matches
 * any forbidden_paths (shared + per-surface). Forbidden wins writable.
 *
 * Path safety (fail-closed):
 * - normalizePath rejects `..` / `.` segments, a leading `/`, and any
 *   backslash leftover after `/` folding. Those paths are violations
 *   (reason: unsafe_path), even if a writable glob would otherwise match.
 * - git diff mode (`--base` / range): reject typechange (`T` in
 *   `git diff --name-status`) and symlink mode 120000 (`git diff --raw`).
 *   A symlink at a writable path must not pass as a path string.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertEvidenceContract,
  V1_EVIDENCE_ALLOWLIST,
  validateEvidencePayload,
} from "./vibeware-evidence.mjs";

export { V1_EVIDENCE_ALLOWLIST, validateEvidencePayload };

export const REQUIRED_SHARED_FORBIDDEN = [
  "src/services/link/session.ts",
  "vibeware.yaml",
  ".github/**",
  "scripts/check-vibeware*",
  "package.json",
  "package-lock.json",
  "src/hooks/useInbox.ts",
  "src/hooks/useChannel.ts",
  "src/hooks/useSignOut.ts",
];

export const MIN_SHARED_FORBIDDEN_PATHS = 40;

const ALLOWED_COHORTS = new Set(["experimental", "internal", "opted_in"]);

export class UnsafePathError extends Error {
  constructor(filePath, detail) {
    super(`unsafe path (${detail}): ${filePath}`);
    this.name = "UnsafePathError";
    this.filePath = filePath;
    this.detail = detail;
  }
}

export function normalizePath(filePath) {
  const trimmed = String(filePath).trim();
  if (trimmed.startsWith("/")) {
    throw new UnsafePathError(trimmed, "absolute");
  }
  const unified = trimmed.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
  if (unified.includes("\\")) {
    throw new UnsafePathError(trimmed, "backslash");
  }
  const segments = unified.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new UnsafePathError(trimmed, "dot-segment");
  }
  return unified;
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

export function stripCommentOutsideQuotes(text) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\" && (inSingle || inDouble)) {
      i += 1;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === "#" && !inSingle && !inDouble) {
      return text.slice(0, i);
    }
  }
  return text;
}

function rejectYamlTokens(raw, lineNumber) {
  if (/(^|\s)<<\s*:/.test(raw) || raw.trim() === "<<" || raw.trim().startsWith("<<:")) {
    throw new Error(`yaml: merge keys are not allowed at line ${lineNumber}`);
  }
  if (/(^|[\s:-])&[A-Za-z0-9_]/.test(raw)) {
    throw new Error(`yaml: anchors are not allowed at line ${lineNumber}`);
  }
  if (/(^|[\s:-])\*[A-Za-z0-9_]/.test(raw)) {
    throw new Error(`yaml: aliases are not allowed at line ${lineNumber}`);
  }
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

function assignUnique(object, key, value, lineNumber) {
  if (Object.prototype.hasOwnProperty.call(object, key)) {
    throw new Error(`yaml: duplicate key ${key} at line ${lineNumber}`);
  }
  if (key === "<<") {
    throw new Error(`yaml: merge keys are not allowed at line ${lineNumber}`);
  }
  object[key] = value;
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
    const strippedLine = stripCommentOutsideQuotes(line.text);
    rejectYamlTokens(strippedLine, line.index);
    const colon = strippedLine.indexOf(":");
    if (colon < 0) {
      throw new Error(`yaml: expected key: at line ${line.index}`);
    }
    const key = strippedLine.slice(0, colon).trim();
    if (!key) throw new Error(`yaml: empty key at line ${line.index}`);
    const rest = strippedLine.slice(colon + 1).trim();
    i += 1;
    if (rest !== "") {
      rejectYamlTokens(rest, line.index);
      assignUnique(object, key, parseScalar(rest, line.index), line.index);
      continue;
    }
    const next = skipBlank(lines, i);
    if (next >= lines.length || lines[next].indent <= keyIndent) {
      assignUnique(object, key, null, line.index);
      continue;
    }
    const [child, after] = parseBlock(lines, next, keyIndent + 1);
    assignUnique(object, key, child, line.index);
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
    const strippedLine = stripCommentOutsideQuotes(line.text);
    rejectYamlTokens(strippedLine, line.index);
    const rest = strippedLine.slice(2);
    const trimmed = rest.trim();
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
      const firstRest = stripCommentOutsideQuotes(trimmed.slice(colon + 1)).trim();
      const item = {};
      if (firstRest !== "") {
        rejectYamlTokens(firstRest, line.index);
        assignUnique(item, firstKey, parseScalar(firstRest, line.index), line.index);
      } else if (hasNested) {
        const [child, after] = parseBlock(lines, next, dashIndent + 1);
        assignUnique(item, firstKey, child, line.index);
        i = after;
      } else {
        assignUnique(item, firstKey, null, line.index);
      }
      const cont = skipBlank(lines, i);
      if (cont < lines.length && lines[cont].indent > dashIndent && !lines[cont].text.startsWith("- ")) {
        const [more, after] = parseMapping(lines, cont, lines[cont].indent);
        for (const [moreKey, moreValue] of Object.entries(more)) {
          assignUnique(item, moreKey, moreValue, lines[cont].index);
        }
        i = after;
      }
      items.push(item);
      continue;
    }
    rejectYamlTokens(trimmed, line.index);
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

function validateExposure(exposure, id) {
  if (!exposure || typeof exposure !== "object" || Array.isArray(exposure)) {
    throw new Error(`vibeware: ${id} exposure is required`);
  }
  const cohorts = asStringList(exposure.allowed_cohorts, `${id} exposure.allowed_cohorts`);
  for (const cohort of cohorts) {
    if (!ALLOWED_COHORTS.has(cohort)) {
      throw new Error(`vibeware: ${id} exposure.allowed_cohorts contains ${cohort}`);
    }
  }
  const max = exposure.max_initial_percent;
  if (typeof max !== "number" || max < 1 || max > 10) {
    throw new Error(`vibeware: ${id} exposure.max_initial_percent must be in 1..10`);
  }
  const human = exposure.requires_human_for_percent_over;
  if (typeof human !== "number" || human < 25) {
    throw new Error(`vibeware: ${id} exposure.requires_human_for_percent_over must be >= 25`);
  }
  return { allowed_cohorts: cohorts, max_initial_percent: max, requires_human_for_percent_over: human };
}

function validateAutonomy(autonomy, id) {
  if (!autonomy || typeof autonomy !== "object" || Array.isArray(autonomy)) {
    throw new Error(`vibeware: ${id} autonomy is required`);
  }
  if (autonomy.auto_merge !== false) {
    throw new Error(`vibeware: ${id} autonomy.auto_merge must be false`);
  }
  if (autonomy.auto_promote !== false) {
    throw new Error(`vibeware: ${id} autonomy.auto_promote must be false`);
  }
  return autonomy;
}

function validateKillSwitch(killSwitch, id) {
  if (!killSwitch || typeof killSwitch !== "object" || Array.isArray(killSwitch)) {
    throw new Error(`vibeware: ${id} kill_switch is required`);
  }
  const flag = requireString(killSwitch.flag, `${id} kill_switch.flag`);
  return { flag };
}

export function loadManifest(text) {
  const doc = parseYaml(text);
  const evidenceAllowlist = asStringList(doc.evidence_allowlist, "evidence_allowlist");
  if (evidenceAllowlist.length === 0) {
    throw new Error("vibeware: evidence_allowlist must not be empty");
  }
  assertEvidenceContract(doc, evidenceAllowlist);
  const sharedForbidden = asStringList(doc.forbidden_paths, "forbidden_paths");
  if (sharedForbidden.length < MIN_SHARED_FORBIDDEN_PATHS) {
    throw new Error(
      `vibeware: forbidden_paths must have at least ${MIN_SHARED_FORBIDDEN_PATHS} entries`,
    );
  }
  for (const required of REQUIRED_SHARED_FORBIDDEN) {
    if (!sharedForbidden.includes(required)) {
      throw new Error(`vibeware: forbidden_paths must include ${required}`);
    }
  }
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
      exposure: validateExposure(entry.exposure, id),
      selection: entry.selection ?? {},
      autonomy: validateAutonomy(entry.autonomy, id),
      kill_switch: validateKillSwitch(entry.kill_switch, id),
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
    evidence_payloads: doc.evidence_payloads,
    max_payload_bytes: doc.max_payload_bytes,
    privacy: doc.privacy,
    forbidden_paths: sharedForbidden,
    surfaces,
  };
}

export function loadManifestFile(manifestPath) {
  return loadManifest(readFileSync(manifestPath, "utf8"));
}

function rejectUnsafe(raw) {
  try {
    return { path: normalizePath(raw), unsafe: false };
  } catch (error) {
    if (error instanceof UnsafePathError) {
      return { path: error.filePath, unsafe: true };
    }
    throw error;
  }
}

export function evaluateChangedFiles(manifest, surfaceId, changedFiles) {
  const surface = manifest.surfaces.find((item) => item.id === surfaceId);
  if (!surface) {
    throw new Error(`unknown surface: ${surfaceId}`);
  }
  const forbiddenPatterns = [...manifest.forbidden_paths, ...surface.forbidden_paths];
  const rejected = [];
  for (const raw of changedFiles) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const checked = rejectUnsafe(raw);
    if (checked.unsafe) {
      rejected.push({ path: checked.path, reason: "unsafe_path", pattern: null });
      continue;
    }
    const filePath = checked.path;
    const forbidden = forbiddenPatterns.find((pattern) => {
      try {
        return pathMatches(pattern, filePath);
      } catch {
        return false;
      }
    });
    if (forbidden) {
      rejected.push({ path: filePath, reason: "forbidden", pattern: forbidden });
      continue;
    }
    const writable = surface.writable_paths.some((pattern) => {
      try {
        return pathMatches(pattern, filePath);
      } catch {
        return false;
      }
    });
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
    .map((line) => stripCommentOutsideQuotes(line).trim())
    .filter(Boolean);
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result.stdout;
}

export function inspectDiffSafety(repoRoot, baseSha, headSha = "HEAD") {
  const spec = `${baseSha}...${headSha}`;
  const rejected = [];
  const nameStatus = runGit(repoRoot, ["diff", "--name-status", spec]);
  for (const line of nameStatus.split(/\r?\n/)) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const status = line.slice(0, tab);
    const filePath = line.slice(tab + 1).split("\t").pop();
    if (status.startsWith("T") && filePath) {
      rejected.push({ path: filePath, reason: "symlink_or_typechange", pattern: null });
    }
  }
  const raw = runGit(repoRoot, ["diff", "--raw", spec]);
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith(":")) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const meta = line.slice(0, tab).split(/\s+/);
    const filePath = line.slice(tab + 1).split("\t").pop();
    const oldMode = (meta[0] || "").replace(/^:/, "");
    const newMode = meta[1] || "";
    if ((oldMode === "120000" || newMode === "120000") && filePath) {
      if (!rejected.some((item) => item.path === filePath)) {
        rejected.push({ path: filePath, reason: "symlink_or_typechange", pattern: null });
      }
    }
  }
  return rejected;
}

export function changedFilesFromRange(repoRoot, baseSha, headSha = "HEAD") {
  const spec = `${baseSha}...${headSha}`;
  const names = runGit(repoRoot, ["diff", "--name-only", spec])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const unsafe = inspectDiffSafety(repoRoot, baseSha, headSha);
  return { files: names, unsafe };
}

export function changedFilesFromBase(repoRoot, baseSha) {
  const { files, unsafe } = changedFilesFromRange(repoRoot, baseSha, "HEAD");
  if (unsafe.length > 0) {
    const labeled = unsafe.map((item) => item.path);
    throw new Error(`symlink or typechange in diff: ${labeled.join(", ")}`);
  }
  return files;
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

function writeRejected(io, rejected) {
  for (const item of rejected) {
    io.stderr.write(`${item.path}\t${item.reason}\n`);
  }
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
    const extraRejected = [];
    for (const listPath of args.changedFiles) {
      files.push(...readChangedFilesList(path.resolve(listPath)));
    }
    if (args.base) {
      const ranged = changedFilesFromRange(repoRoot, args.base, "HEAD");
      files.push(...ranged.files);
      extraRejected.push(...ranged.unsafe);
    }
    const result = evaluateChangedFiles(manifest, args.surface, files);
    const rejected = [...extraRejected, ...result.rejected];
    if (rejected.length > 0) {
      writeRejected(io, rejected);
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
