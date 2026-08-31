#!/usr/bin/env node
/**
 * Phase 3 generation halfway checkpoint: dry-run a candidate in a throwaway
 * git worktree. Deterministic fixture patch (no LLM). No remotes, no PR.
 *
 *   node scripts/vibeware-sandbox.mjs --surface hc-chats-ui \
 *     --problem fixtures/vibeware/empty-state-problem.json \
 *     --out /tmp/vibeware-candidate-ok
 *
 *   node scripts/vibeware-sandbox.mjs --surface hc-chats-ui \
 *     --problem fixtures/vibeware/empty-state-problem.json \
 *     --out /tmp/vibeware-candidate-bad --probe-session
 */
import { spawnSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  evaluateChangedFiles,
  loadManifestFile,
  normalizePath,
} from "./check-vibeware-path-policy.mjs";

export const EMPTY_STATE_FILE = "src/components/chats-page.tsx";
export const EMPTY_STATE_FIND = "Start a new chat from the field above.";
export const EMPTY_STATE_REPLACE = "Use the field above to start a chat.";
export const SESSION_FILE = "src/services/link/session.ts";
export const SESSION_PROBE_EXPORT = "export const VIBEWARE_SANDBOX_PROBE = true;";

export const BOUNDARY_PREFIXES = [
  "vibeware.yaml",
  "scripts/vibeware-evidence.mjs",
  "scripts/vibeware-evidence.d.ts",
  "scripts/vibeware-evidence.d.mts",
  "src/services/vibeware/",
  ".github/",
];

export const SANDBOX_STRIP_ENV = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_PAT",
  "GITHUB_PAT",
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "RAILWAY_TOKEN",
  "RAILWAY_API_TOKEN",
  "STAGING_SIGNUP_TOKEN",
  "STAGING_INVITE",
  "STAGING_INVITE_CODE",
  "STAGING_INVITE_PASSWORD",
  "HYPERCOLOR_READ_TOKEN",
  "NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN",
  "NODE_AUTH_TOKEN",
  "NPM_TOKEN",
];

export const SANDBOX_STRIP_PREFIXES = [
  "GITHUB_",
  "GH_",
  "VERCEL_",
  "RAILWAY_",
  "STAGING_",
  "AWS_",
  "NPM_",
  "NODE_AUTH",
];

export const SANDBOX_ENV_ALLOWLIST = [
  "NODE_ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "npm_config_user_agent",
  "npm_lifecycle_event",
];

const SANDBOX_STRIP_SUFFIX_RE = /_TOKEN$|_SECRET$|_KEY$|_PASSWORD$/i;
const NPM_CONFIG_AUTH_TOKEN_RE = /^npm_config_.*authToken/i;

// Tripwire only. Computed-member aliases (window["eval"], setAttribute("onclick"),
// constructor.constructor) are an accepted gap — see docs/vibeware.md F9.
export const DIFF_DANGER_PATTERNS = [
  ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
  ["eval(", /\beval\s*\(/],
  ["<script", /<script/i],
  ["javascript:", /javascript:/i],
  // HTML onclick=/onerror=/ONCLICK=; camelCase onClick= only with a string, not JSX onClick={
  ["on*=", /\bon[a-z]+\s*=|\bon[A-Za-z]+\s*=\s*["'`]|\bON[A-Z]+\s*=/],
  ["new Function", /new\s+Function\b/],
  ["Function(", /\bFunction\s*\(/],
  ["innerHTML", /\binnerHTML\b/],
  ["outerHTML", /\bouterHTML\b/],
  ["document.write", /document\.write/],
  ["srcDoc", /srcDoc/],
  ["setTimeout(", /set(?:Timeout|Interval)\s*\(\s*["'`]/],
];

const ARTIFACT_CREDENTIAL_URL_RE = /:\/\/[^/\s:]+:[^/\s@]+@/;
const ARTIFACT_AWS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/;
const ARTIFACT_LONG_HEX_RE = /\b[0-9a-fA-F]{64,}\b/;
const ARTIFACT_RECOVERY_PHRASE_RE = /\b(?:[a-z]{3,8}\s+){11,}[a-z]{3,8}\b/;

const PUBKY_ZBASE32 = /(?:^|[^a-z1-9])[ybndrfg8ejkmcpqxot1uwisza345h769]{52}(?:[^a-z1-9]|$)/i;
const EVIDENCE_REF_RE = /^ev_[a-z0-9_]+$/;

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function usage() {
  return [
    "Usage:",
    "  node scripts/vibeware-sandbox.mjs --surface <id> --problem <file> --out <dir>",
    "    [--base-sha <sha>] [--keep] [--probe-session] [--skip-validate] [--repo <dir>]",
  ].join("\n");
}

export function parseArgs(argv) {
  const out = {
    surface: null,
    problem: null,
    out: null,
    baseSha: "HEAD",
    keep: false,
    probeSession: false,
    skipValidate: false,
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
      case "--surface":
        out.surface = next();
        break;
      case "--problem":
        out.problem = next();
        break;
      case "--out":
        out.out = next();
        break;
      case "--base-sha":
        out.baseSha = next();
        break;
      case "--keep":
        out.keep = true;
        break;
      case "--probe-session":
        out.probeSession = true;
        break;
      case "--skip-validate":
        out.skipValidate = true;
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

export function isSandboxStrippedEnvKey(key) {
  if (SANDBOX_ENV_ALLOWLIST.includes(key)) {
    return false;
  }
  if (SANDBOX_STRIP_ENV.includes(key)) {
    return true;
  }
  if (SANDBOX_STRIP_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return true;
  }
  if (SANDBOX_STRIP_SUFFIX_RE.test(key)) {
    return true;
  }
  if (NPM_CONFIG_AUTH_TOKEN_RE.test(key)) {
    return true;
  }
  return false;
}

export function stripSecretsFromEnv(env = process.env) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (isSandboxStrippedEnvKey(key)) {
      delete next[key];
    }
  }
  return next;
}

export function containsPubkyId(text) {
  return PUBKY_ZBASE32.test(String(text)) || /pubky:\/\//i.test(String(text));
}

export function assertArtifactSafe(label, text) {
  if (containsPubkyId(text)) {
    throw new Error(`${label} must not contain a pubky id or pubky:// URI`);
  }
  if (/(authorization:\s*bearer|sk_[a-z0-9]+|ghp_[a-zA-Z0-9]+)/i.test(text)) {
    throw new Error(`${label} must not contain tokens`);
  }
  if (/"body"\s*:|"message_body"\s*:|"raw_json"\s*:/.test(text)) {
    throw new Error(`${label} must not contain message bodies`);
  }
  if (ARTIFACT_CREDENTIAL_URL_RE.test(text)) {
    throw new Error(`${label} must not contain credentialed URLs`);
  }
  if (ARTIFACT_AWS_KEY_RE.test(text)) {
    throw new Error(`${label} must not contain AWS-style access keys`);
  }
  if (ARTIFACT_LONG_HEX_RE.test(text)) {
    throw new Error(`${label} must not contain long hex secrets`);
  }
  if (ARTIFACT_RECOVERY_PHRASE_RE.test(text)) {
    throw new Error(`${label} must not contain recovery-phrase-like text`);
  }
}

export function loadProblem(filePath) {
  const raw = readFileSync(filePath, "utf8");
  assertArtifactSafe("problem.json", raw);
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    throw new Error(`problem.json is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("problem.json must be an object");
  }
  if (doc.status !== "qualified") {
    throw new Error("problem.json status must be qualified");
  }
  if (!Array.isArray(doc.evidence_refs) || doc.evidence_refs.length === 0) {
    throw new Error("problem.json evidence_refs must be a non-empty list of fake ids");
  }
  for (const ref of doc.evidence_refs) {
    if (typeof ref !== "string" || !EVIDENCE_REF_RE.test(ref)) {
      throw new Error(`evidence_refs must be fake ids matching ev_[a-z0-9_]+ (got ${ref})`);
    }
  }
  const problem = doc.problem;
  if (!problem || typeof problem !== "object") {
    throw new Error("problem.json problem object is required");
  }
  if (typeof problem.target_file !== "string" || !problem.target_file.trim()) {
    throw new Error("problem.problem.target_file is required");
  }
  if (typeof problem.find !== "string" || !problem.find) {
    throw new Error("problem.problem.find is required");
  }
  if (typeof problem.replace !== "string" || !problem.replace) {
    throw new Error("problem.problem.replace is required");
  }
  return doc;
}

export function resolveScope(manifest, surfaceId, problem) {
  const surface = manifest.surfaces.find((item) => item.id === surfaceId);
  if (!surface) {
    throw new Error(`unknown surface: ${surfaceId}`);
  }
  const fromYaml = {
    writable_paths: [...surface.writable_paths],
    forbidden_paths: [...manifest.forbidden_paths, ...surface.forbidden_paths],
    source: "vibeware.yaml",
  };
  const request = problem.candidate_request;
  if (!request || typeof request !== "object") {
    return fromYaml;
  }
  if (request.surface && request.surface !== surfaceId) {
    throw new Error(
      `candidate_request.surface ${request.surface} does not match --surface ${surfaceId}`,
    );
  }
  const writable =
    Array.isArray(request.writable_paths) && request.writable_paths.length > 0
      ? request.writable_paths.map((item) => String(item))
      : fromYaml.writable_paths;
  const extraForbidden = Array.isArray(request.forbidden_paths)
    ? request.forbidden_paths.map((item) => String(item))
    : [];
  return {
    writable_paths: writable,
    forbidden_paths: [...new Set([...fromYaml.forbidden_paths, ...extraForbidden])],
    source: "candidate_request+yaml",
  };
}

function runGit(cwd, args, env, allowFail = false) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env,
  });
  if (result.status !== 0 && !allowFail) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result;
}

export function resolveSha(repoRoot, rev, env) {
  return runGit(repoRoot, ["rev-parse", "--verify", rev], env).stdout.trim();
}

export function resolveWorktreePath(worktree, rel) {
  const normalized = normalizePath(rel);
  const root = path.resolve(worktree);
  const full = path.resolve(root, normalized);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!full.startsWith(prefix)) {
    throw new Error(`path escapes worktree: ${rel}`);
  }
  return { rel: normalized, full };
}

export function applyFixturePatch(worktree, problem) {
  const rel = problem.problem?.target_file || EMPTY_STATE_FILE;
  const find = problem.problem?.find || EMPTY_STATE_FIND;
  const replace = problem.problem?.replace || EMPTY_STATE_REPLACE;
  const { rel: safeRel, full } = resolveWorktreePath(worktree, rel);
  if (!existsSync(full)) {
    throw new Error(`fixture target missing: ${safeRel}`);
  }
  const text = readFileSync(full, "utf8");
  const count = text.split(find).length - 1;
  if (count !== 1) {
    throw new Error(`fixture find must match exactly once in ${safeRel}, got ${count}`);
  }
  writeFileSync(full, text.replace(find, replace));
  return safeRel;
}

export function applySessionProbe(worktree) {
  const { full } = resolveWorktreePath(worktree, SESSION_FILE);
  if (!existsSync(full)) {
    throw new Error(`probe target missing: ${SESSION_FILE}`);
  }
  const text = readFileSync(full, "utf8");
  if (text.includes("VIBEWARE_SANDBOX_PROBE")) {
    return SESSION_FILE;
  }
  writeFileSync(full, `${text.replace(/\s*$/, "")}\n\n${SESSION_PROBE_EXPORT}\n`);
  return SESSION_FILE;
}

export function collectChangedFiles(worktree, baseSha, env) {
  const names = runGit(worktree, ["diff", "--name-only", baseSha, "--"], env)
    .stdout.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const unsafe = [];
  const nameStatus = runGit(worktree, ["diff", "--name-status", baseSha, "--"], env).stdout;
  for (const line of nameStatus.split(/\r?\n/)) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const status = line.slice(0, tab);
    const filePath = line.slice(tab + 1).split("\t").pop();
    if (status.startsWith("T") && filePath) {
      unsafe.push({ path: filePath, reason: "symlink_or_typechange", pattern: null });
    }
  }
  const raw = runGit(worktree, ["diff", "--raw", baseSha, "--"], env).stdout;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith(":")) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const meta = line.slice(0, tab).split(/\s+/);
    const filePath = line.slice(tab + 1).split("\t").pop();
    const oldMode = (meta[0] || "").replace(/^:/, "");
    const newMode = meta[1] || "";
    if ((oldMode === "120000" || newMode === "120000") && filePath) {
      if (!unsafe.some((item) => item.path === filePath)) {
        unsafe.push({ path: filePath, reason: "symlink_or_typechange", pattern: null });
      }
    }
  }
  return { files: names, unsafe };
}

export function addedLines(diff) {
  return diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
}

export function scanDiffForDanger(diff) {
  const findings = [];
  const added = addedLines(diff).join("\n");
  for (const [label, pattern] of DIFF_DANGER_PATTERNS) {
    if (pattern.test(added)) {
      findings.push(label);
    }
  }
  return findings;
}

export function boundaryViolations(files) {
  return files.filter((filePath) =>
    BOUNDARY_PREFIXES.some((prefix) => {
      if (prefix.endsWith("/")) return filePath === prefix.slice(0, -1) || filePath.startsWith(prefix);
      return filePath === prefix;
    }),
  );
}

function writeChangedList(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "vibeware-sandbox-files-"));
  const listPath = path.join(dir, "changed-files");
  writeFileSync(listPath, files.length ? `${files.join("\n")}\n` : "");
  return listPath;
}

export function runPathPolicy({ repoRoot, worktree, surface, files, env }) {
  const listPath = writeChangedList(files);
  const policy = path.join(repoRoot, "scripts/check-vibeware-path-policy.mjs");
  const manifest = path.join(repoRoot, "vibeware.yaml");
  const result = spawnSync(process.execPath, [
    policy,
    "--manifest",
    manifest,
    "--surface",
    surface,
    "--changed-files",
    listPath,
    "--repo",
    worktree,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  const rejected = [];
  for (const line of (result.stderr || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [filePath, reason] = trimmed.split("\t");
    rejected.push({ path: filePath, reason: reason || "rejected" });
  }
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    rejected,
  };
}

function ensureLink(from, to) {
  if (existsSync(to)) return;
  symlinkSync(from, to);
}

function prepareWorktreeLinks(repoRoot, worktree) {
  // F7: shared node_modules/.cache symlinks mean validation writes may mutate those caches; product source is not shared.
  const nodeModules = path.join(repoRoot, "node_modules");
  if (existsSync(nodeModules)) {
    ensureLink(nodeModules, path.join(worktree, "node_modules"));
  }
  const cache = path.join(repoRoot, ".cache");
  if (existsSync(cache)) {
    ensureLink(cache, path.join(worktree, ".cache"));
  }
  const wasm = path.join(repoRoot, "public/sqlite3.wasm");
  if (existsSync(wasm)) {
    copyFileSync(wasm, path.join(worktree, "public/sqlite3.wasm"));
  }
  writeFileSync(
    path.join(worktree, "next-env.d.ts"),
    [
      "/// <reference types=\"next\" />",
      "/// <reference types=\"next/image-types/global\" />",
      "",
    ].join("\n"),
  );
}

export function playwrightBrowsersAvailable(env) {
  const cache = path.join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return false;
  try {
    const result = spawnSync("npx", ["playwright", "--version"], {
      encoding: "utf8",
      timeout: 15_000,
      env,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function runNpm(worktree, script, env) {
  const childEnv = script === "test" ? { ...env, VIBEWARE_SANDBOX_INNER: "1" } : env;
  const result = spawnSync("npm", ["run", script], {
    cwd: worktree,
    encoding: "utf8",
    env: childEnv,
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    command: `npm run ${script}`,
  };
}

function waitForHttp(url, timeoutMs, child) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (child.exitCode !== null) {
        reject(new Error(`dev server exited ${child.exitCode}`));
        return;
      }
      fetch(url, { redirect: "manual" })
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - started > timeoutMs) {
            reject(new Error(`timed out waiting for ${url}`));
            return;
          }
          setTimeout(tick, 400);
        });
    };
    tick();
  });
}

async function runUiSmoke(worktree, env) {
  const port = 37000 + (randomBytes(2).readUInt16BE(0) % 2000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
    cwd: worktree,
    env: { ...env, NEXT_PUBLIC_E2E_HARNESS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  try {
    await waitForHttp(baseUrl, 120_000, child);
    const result = spawnSync(
      "npx",
      ["playwright", "test", "e2e/ui-smoke.spec.ts"],
      {
        cwd: worktree,
        encoding: "utf8",
        env: { ...env, PLAYWRIGHT_BASE_URL: baseUrl },
      },
    );
    return {
      ok: result.status === 0,
      status: result.status ?? 1,
      skipped: false,
      reason: null,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      command: `PLAYWRIGHT_BASE_URL=${baseUrl} npx playwright test e2e/ui-smoke.spec.ts`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 1,
      skipped: false,
      reason: error instanceof Error ? error.message : String(error),
      stdout: output,
      stderr: error instanceof Error ? error.message : String(error),
      command: `npm run dev -- --port ${port}`,
    };
  } finally {
    child.kill("SIGTERM");
    const killer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 3000);
    await new Promise((resolve) => {
      child.once("exit", () => {
        clearTimeout(killer);
        resolve();
      });
    });
  }
}

function runEmptyStateUnit(worktree, env) {
  const result = spawnSync(
    "npx",
    ["vitest", "run", "src/components/chats-page.empty-state.test.ts"],
    {
      cwd: worktree,
      encoding: "utf8",
      env,
    },
  );
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    command: "npx vitest run src/components/chats-page.empty-state.test.ts",
  };
}

async function runValidations({ worktree, env, diff, files }) {
  const build = {
    typecheck: runNpm(worktree, "typecheck", env),
    test: runNpm(worktree, "test", env),
    wasm: runNpm(worktree, "check:wasm", env),
    wire: runNpm(worktree, "check:wire", env),
  };
  const danger = scanDiffForDanger(diff);
  const boundary = boundaryViolations(files);
  const browsers = playwrightBrowsersAvailable(env);
  let e2e;
  if (browsers) {
    e2e = await runUiSmoke(worktree, env);
  } else {
    e2e = {
      ok: true,
      skipped: true,
      reason: "playwright browsers not found; ran empty-state unit tests instead",
      command: null,
    };
  }
  const unit = runEmptyStateUnit(worktree, env);
  const buildOk = build.typecheck.ok && build.test.ok && build.wasm.ok && build.wire.ok;
  const securityOk = danger.length === 0;
  const behavioralOk = unit.ok && e2e.ok;
  const boundaryOk = boundary.length === 0;
  return {
    ok: buildOk && securityOk && behavioralOk && boundaryOk,
    build: {
      ok: buildOk,
      commands: {
        typecheck: summarizeRun(build.typecheck),
        test: summarizeRun(build.test),
        "check:wasm": summarizeRun(build.wasm),
        "check:wire": summarizeRun(build.wire),
      },
    },
    security: {
      ok: securityOk,
      danger,
    },
    behavioral: {
      ok: behavioralOk,
      e2e: e2e.skipped
        ? { skipped: true, reason: e2e.reason }
        : summarizeRun(e2e),
      unit: summarizeRun(unit),
    },
    boundary: {
      ok: boundaryOk,
      unchanged: BOUNDARY_PREFIXES,
      violations: boundary,
    },
  };
}

function summarizeRun(run) {
  if (!run) return null;
  const snippet = [run.stderr, run.stdout].filter(Boolean).join("\n").trim();
  return {
    ok: run.ok,
    command: run.command,
    skipped: run.skipped || false,
    reason: run.reason || null,
    excerpt: snippet ? snippet.slice(-800) : "",
  };
}

function destroyWorktree(repoRoot, worktree, env) {
  runGit(repoRoot, ["worktree", "remove", "--force", worktree], env, true);
  runGit(repoRoot, ["worktree", "prune"], env, true);
  if (existsSync(worktree)) {
    rmSync(worktree, { recursive: true, force: true });
  }
}

export function buildCandidate({
  surface,
  baseSha,
  scope,
  files,
  explanation,
  rollback,
  tests,
  validation,
  probeSession,
  rejected,
  worktree,
  keep,
}) {
  const candidate = {
    surface,
    base_sha: baseSha,
    mode: probeSession ? "probe-session" : "in-scope",
    allowed_paths: scope.writable_paths,
    forbidden_paths: scope.forbidden_paths,
    scope_source: scope.source,
    files,
    explanation,
    rollback,
    tests,
    validation,
    rejected: rejected || [],
    worktree: keep ? worktree : null,
  };
  const encoded = `${JSON.stringify(candidate, null, 2)}\n`;
  assertArtifactSafe("candidate.json", encoded);
  return encoded;
}

export async function runSandbox(args, io = process) {
  const env = stripSecretsFromEnv(process.env);
  const pin = path.join(DEFAULT_ROOT, "vendor/hypercolor-wire-pin");
  if (existsSync(pin)) {
    env.HYPERCOLOR_REPO = pin;
  }
  const repoRoot = args.repo ? path.resolve(args.repo) : DEFAULT_ROOT;
  if (!args.surface || !args.problem || !args.out) {
    io.stderr.write(`${usage()}\n`);
    return 2;
  }
  const problemPath = path.resolve(repoRoot, args.problem);
  const outDir = path.resolve(args.out);
  const problem = loadProblem(problemPath);
  const surface = args.surface;
  if (problem.surface && problem.surface !== surface) {
    throw new Error(`problem.surface ${problem.surface} does not match --surface ${surface}`);
  }
  const manifest = loadManifestFile(path.join(repoRoot, "vibeware.yaml"));
  const scope = resolveScope(manifest, surface, problem);
  const baseSha = resolveSha(repoRoot, args.baseSha, env);
  const sandboxId = randomBytes(6).toString("hex");
  // F8: --keep is opt-in and not product; kept dirs are named vibeware-sandbox-KEEP-… .
  const worktreeName = args.keep
    ? `vibeware-sandbox-KEEP-${sandboxId}`
    : `vibeware-sandbox-${sandboxId}`;
  const worktree = path.join(tmpdir(), worktreeName);
  mkdirSync(outDir, { recursive: true });
  if (args.keep) {
    io.stderr.write(
      "warning: --keep is opt-in; the kept worktree is not product source\n",
    );
  }

  let exitCode = 1;
  try {
    runGit(repoRoot, ["worktree", "add", "--detach", worktree, baseSha], env);
    applyFixturePatch(worktree, problem);
    if (args.probeSession) {
      applySessionProbe(worktree);
    }
    const { files, unsafe } = collectChangedFiles(worktree, baseSha, env);
    const diff = runGit(worktree, ["diff", baseSha, "--"], env).stdout;
    assertArtifactSafe("candidate.diff", diff);
    writeFileSync(path.join(outDir, "candidate.diff"), diff);

    const policy = runPathPolicy({
      repoRoot,
      worktree,
      surface,
      files,
      env,
    });
    const rejected = [...unsafe, ...policy.rejected];
    const policyOk = rejected.length === 0;

    if (args.probeSession) {
      const sessionRejected = rejected.some(
        (item) => item.path === SESSION_FILE && item.reason === "forbidden",
      );
      if (!sessionRejected) {
        throw new Error("expected path-policy to reject src/services/link/session.ts as forbidden");
      }
      const encoded = buildCandidate({
        surface,
        baseSha,
        scope,
        files,
        explanation: "Probe: in-scope empty-state copy plus a deliberate session.ts edit.",
        rollback: "Throwaway worktree is removed unless --keep. Main is unchanged.",
        tests: [
          "check-vibeware-path-policy --surface hc-chats-ui",
        ],
        validation: {
          build: { ok: false, skipped: true, reason: "probe stops at path-policy" },
          security: { ok: false, path_policy: "rejected", rejected },
          behavioral: { ok: false, skipped: true },
          boundary: { ok: false, skipped: true },
        },
        probeSession: true,
        rejected,
        worktree,
        keep: args.keep,
      });
      writeFileSync(path.join(outDir, "candidate.json"), encoded);
      io.stderr.write(`session.ts\tforbidden\n`);
      exitCode = 1;
      return exitCode;
    }

    if (!policyOk) {
      const encoded = buildCandidate({
        surface,
        baseSha,
        scope,
        files,
        explanation: "In-scope dry-run failed path-policy.",
        rollback: "Throwaway worktree is removed unless --keep. Main is unchanged.",
        tests: ["check-vibeware-path-policy --surface hc-chats-ui"],
        validation: {
          build: { ok: false, skipped: true },
          security: { ok: false, path_policy: "rejected", rejected },
          behavioral: { ok: false, skipped: true },
          boundary: { ok: false, skipped: true },
        },
        probeSession: false,
        rejected,
        worktree,
        keep: args.keep,
      });
      writeFileSync(path.join(outDir, "candidate.json"), encoded);
      for (const item of rejected) {
        io.stderr.write(`${item.path}\t${item.reason}\n`);
      }
      exitCode = 1;
      return exitCode;
    }

    const extra = files.filter((filePath) => !scope.writable_paths.includes(filePath));
    if (extra.length > 0) {
      throw new Error(`changed files outside candidate writable_paths: ${extra.join(", ")}`);
    }
    if (files.length !== 1 || files[0] !== EMPTY_STATE_FILE) {
      throw new Error(`in-scope dry-run must change only ${EMPTY_STATE_FILE}, got ${files.join(", ")}`);
    }

    const localPolicy = evaluateChangedFiles(manifest, surface, files);
    if (!localPolicy.ok) {
      throw new Error("evaluateChangedFiles rejected an in-scope chats-page-only diff");
    }

    prepareWorktreeLinks(repoRoot, worktree);
    let validation = {
      build: { ok: true, skipped: true, reason: "--skip-validate" },
      security: {
        ok: true,
        path_policy: "pass",
        danger: scanDiffForDanger(diff),
      },
      behavioral: { ok: true, skipped: true, reason: "--skip-validate" },
      boundary: {
        ok: boundaryViolations(files).length === 0,
        unchanged: BOUNDARY_PREFIXES,
        violations: boundaryViolations(files),
      },
    };
    if (!args.skipValidate) {
      validation = await runValidations({ worktree, env, diff, files });
      validation.security.path_policy = "pass";
      validation.security.ok = validation.security.ok && validation.security.danger.length === 0;
    }
    if (validation.security.danger?.length) {
      throw new Error(`diff introduces ${validation.security.danger.join(", ")}`);
    }
    if (!validation.boundary.ok) {
      throw new Error(`boundary files changed: ${validation.boundary.violations.join(", ")}`);
    }
    if (!args.skipValidate && !validation.ok) {
      const encoded = buildCandidate({
        surface,
        baseSha,
        scope,
        files,
        explanation: "Deterministic empty-state copy tweak on chats inbox chrome.",
        rollback:
          "Throwaway worktree is removed unless --keep. Main never received the fixture copy change.",
        tests: [
          "src/components/chats-page.empty-state.test.ts",
          "e2e/ui-smoke.spec.ts",
          "npm run typecheck",
          "npm test",
          "npm run check:wasm",
          "npm run check:wire",
        ],
        validation,
        probeSession: false,
        rejected: [],
        worktree,
        keep: args.keep,
      });
      writeFileSync(path.join(outDir, "candidate.json"), encoded);
      io.stderr.write("sandbox validation failed\n");
      exitCode = 1;
      return exitCode;
    }

    const encoded = buildCandidate({
      surface,
      baseSha,
      scope,
      files,
      explanation: "Deterministic empty-state copy tweak on chats inbox chrome.",
      rollback:
        "Throwaway worktree is removed unless --keep. Main never received the fixture copy change. Recreate with the same --base-sha and fixture.",
      tests: [
        "src/components/chats-page.empty-state.test.ts",
        "e2e/ui-smoke.spec.ts",
        "npm run typecheck",
        "npm test",
        "npm run check:wasm",
        "npm run check:wire",
        "check-vibeware-path-policy --surface hc-chats-ui",
      ],
      validation,
      probeSession: false,
      rejected: [],
      worktree,
      keep: args.keep,
    });
    writeFileSync(path.join(outDir, "candidate.json"), encoded);
    io.stdout.write(`${path.join(outDir, "candidate.json")}\n`);
    exitCode = 0;
    return exitCode;
  } finally {
    if (!args.keep) {
      destroyWorktree(repoRoot, worktree, env);
    }
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
  return runSandbox(args, io).then(
    (code) => code,
    (error) => {
      io.stderr.write(`${error instanceof Error ? error.message : error}\n`);
      return 1;
    },
  );
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  Promise.resolve(main()).then((code) => {
    process.exitCode = code;
  });
}
