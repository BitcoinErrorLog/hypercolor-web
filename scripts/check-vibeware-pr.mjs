#!/usr/bin/env node
/**
 * Evaluate a real PR (or local --base/--head range) against the BASE
 * vibeware.yaml. Candidate PRs cannot rewrite the evaluator.
 *
 * Candidate iff:
 *   - head branch matches vibeware/** or candidate/**
 *   - OR HEAD contains .vibeware/candidate with `surface: <id>`
 *
 * A vibeware/** or candidate/** branch without the marker FAILS.
 * Non-candidates skip writable-path denial (human PRs may edit session.ts).
 *
 * When --base and --head are passed, always evaluate candidate status.
 * Without those flags, skip (exit 0) unless this is a candidate branch
 * or a GitHub pull_request event.
 *
 * `.vibeware/candidate` itself is excluded from the path-policy file list
 * so adding the required marker is not outside_writable.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  changedFilesFromRange,
  evaluateChangedFiles,
  loadManifest,
  parseYaml,
} from "./check-vibeware-path-policy.mjs";

const CANDIDATE_MARKER = ".vibeware/candidate";
const ZERO_SHA = /^0+$/;

function usage() {
  return [
    "Usage:",
    "  node scripts/check-vibeware-pr.mjs --base <sha> --head <sha> [--head-ref <branch>] [--repo <dir>]",
  ].join("\n");
}

export function isCandidateBranchName(ref) {
  if (!ref) return false;
  const name = ref.replace(/^refs\/heads\//, "");
  return name.startsWith("vibeware/") || name.startsWith("candidate/");
}

export function parseCandidateSurface(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error(`${CANDIDATE_MARKER} is empty`);
  }
  try {
    const doc = parseYaml(trimmed);
    if (doc && typeof doc.surface === "string" && doc.surface.trim()) {
      return doc.surface.trim();
    }
  } catch {
    // text form below
  }
  const match = trimmed.match(/^\s*surface:\s*(\S+)/m);
  if (match?.[1]) return match[1];
  throw new Error(`${CANDIDATE_MARKER} must declare surface: <id>`);
}

function git(repoRoot, args, allowFail = false) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0 && !allowFail) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result;
}

export function readHeadMarker(repoRoot, headSha) {
  const result = git(repoRoot, ["show", `${headSha}:${CANDIDATE_MARKER}`], true);
  if (result.status !== 0) return null;
  return parseCandidateSurface(result.stdout);
}

function parseArgs(argv) {
  const out = {
    base: null,
    head: null,
    headRef: null,
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
      case "--base":
        out.base = next();
        break;
      case "--head":
        out.head = next();
        break;
      case "--head-ref":
        out.headRef = next();
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

function currentBranch(repoRoot) {
  const result = git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], true);
  if (result.status !== 0) return "";
  return (result.stdout || "").trim();
}

export function evaluatePullRequest({
  repoRoot,
  baseSha,
  headSha,
  headRef,
}) {
  if (!baseSha || !headSha || ZERO_SHA.test(baseSha) || ZERO_SHA.test(headSha)) {
    throw new Error("base and head shas are required");
  }
  const branchCandidate = isCandidateBranchName(headRef);
  let surface = null;
  try {
    surface = readHeadMarker(repoRoot, headSha);
  } catch (error) {
    return {
      ok: false,
      candidate: true,
      message: error instanceof Error ? error.message : String(error),
      rejected: [],
    };
  }
  if (branchCandidate && !surface) {
    return {
      ok: false,
      candidate: true,
      message: `branch ${headRef} is a candidate but ${CANDIDATE_MARKER} is missing`,
      rejected: [],
    };
  }
  if (!branchCandidate && !surface) {
    return {
      ok: true,
      candidate: false,
      message: "not a vibeware candidate; skipping writable-path denial",
      rejected: [],
    };
  }
  const shown = git(repoRoot, ["show", `${baseSha}:vibeware.yaml`]);
  const manifest = loadManifest(shown.stdout);
  const { files, unsafe } = changedFilesFromRange(repoRoot, baseSha, headSha);
  const policyFiles = files.filter((filePath) => filePath !== CANDIDATE_MARKER);
  const result = evaluateChangedFiles(manifest, surface, policyFiles);
  const rejected = [...unsafe, ...result.rejected];
  return {
    ok: rejected.length === 0,
    candidate: true,
    surface,
    files: policyFiles,
    rejected,
    message:
      rejected.length === 0
        ? `candidate ${surface}: path policy passed against base manifest`
        : `candidate ${surface}: path policy failed against base manifest`,
  };
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
  const repoRoot = args.repo
    ? path.resolve(args.repo)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const rangePassed = Boolean(args.base && args.head);
  const headRef =
    args.headRef ||
    process.env.GITHUB_HEAD_REF ||
    currentBranch(repoRoot);
  const onGithubPr = process.env.GITHUB_EVENT_NAME === "pull_request";
  if (rangePassed && (ZERO_SHA.test(args.base) || ZERO_SHA.test(args.head))) {
    if (isCandidateBranchName(headRef)) {
      io.stderr.write("candidate PR is missing a usable base/head sha\n");
      return 1;
    }
    io.stdout.write("check:vibeware:pr skip (empty base/head sha)\n");
    return 0;
  }
  if (!rangePassed) {
    const localCandidate = isCandidateBranchName(headRef);
    if (!localCandidate && !onGithubPr) {
      io.stdout.write("check:vibeware:pr skip (not a candidate, not a PR)\n");
      return 0;
    }
    io.stderr.write(`${usage()}\n`);
    return 2;
  }
  try {
    const result = evaluatePullRequest({
      repoRoot,
      baseSha: args.base,
      headSha: args.head,
      headRef,
    });
    io.stdout.write(`${result.message}\n`);
    if (!result.ok) {
      for (const item of result.rejected) {
        io.stderr.write(`${item.path}\t${item.reason}\n`);
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
