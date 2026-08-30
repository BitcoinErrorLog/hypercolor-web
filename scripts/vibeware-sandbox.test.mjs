import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateChangedFiles, loadManifestFile } from "./check-vibeware-path-policy.mjs";
import {
  EMPTY_STATE_FILE,
  EMPTY_STATE_FIND,
  EMPTY_STATE_REPLACE,
  SESSION_FILE,
  SESSION_PROBE_EXPORT,
  SANDBOX_STRIP_ENV,
  addedLines,
  applyFixturePatch,
  applySessionProbe,
  assertArtifactSafe,
  boundaryViolations,
  buildCandidate,
  containsPubkyId,
  loadProblem,
  parseArgs,
  resolveScope,
  scanDiffForDanger,
  stripSecretsFromEnv,
} from "./vibeware-sandbox.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "fixtures/vibeware/empty-state-problem.json");
const SANDBOX = path.join(ROOT, "scripts/vibeware-sandbox.mjs");
const temps = [];

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("vibeware sandbox args and problem fixture", () => {
  it("defaults base-sha to HEAD and keeps probe off", () => {
    const args = parseArgs([
      "--surface",
      "hc-chats-ui",
      "--problem",
      "fixtures/vibeware/empty-state-problem.json",
      "--out",
      "/tmp/vibeware-candidate-ok",
    ]);
    expect(args.baseSha).toBe("HEAD");
    expect(args.probeSession).toBe(false);
    expect(args.keep).toBe(false);
    expect(args.skipValidate).toBe(false);
  });

  it("loads the qualified empty-state fixture with fake evidence ids", () => {
    const problem = loadProblem(FIXTURE);
    expect(problem.status).toBe("qualified");
    expect(problem.surface).toBe("hc-chats-ui");
    expect(problem.evidence_refs).toEqual(["ev_fixture_0001", "ev_fixture_0002"]);
    expect(problem.problem.target_file).toBe(EMPTY_STATE_FILE);
    expect(problem.problem.find).toBe(EMPTY_STATE_FIND);
    expect(problem.problem.replace).toBe(EMPTY_STATE_REPLACE);
  });

  it("rejects a problem whose evidence_refs look like real identifiers", () => {
    const dir = tempDir("vibeware-problem-");
    const file = path.join(dir, "problem.json");
    writeFileSync(
      file,
      JSON.stringify({
        status: "qualified",
        surface: "hc-chats-ui",
        evidence_refs: ["not-a-fake-id"],
        problem: {
          target_file: EMPTY_STATE_FILE,
          find: EMPTY_STATE_FIND,
          replace: EMPTY_STATE_REPLACE,
        },
      }),
    );
    expect(() => loadProblem(file)).toThrow(/ev_\[a-z0-9_\]/);
  });
});

describe("vibeware sandbox patches and policy", () => {
  it("applies the empty-state copy once and only on chats-page.tsx", () => {
    const tree = tempDir("vibeware-patch-");
    const relDir = path.join(tree, "src/components");
    mkdirSync(relDir, { recursive: true });
    const src = readFileSync(path.join(ROOT, EMPTY_STATE_FILE), "utf8");
    writeFileSync(path.join(tree, EMPTY_STATE_FILE), src);
    const problem = loadProblem(FIXTURE);
    expect(applyFixturePatch(tree, problem)).toBe(EMPTY_STATE_FILE);
    const patched = readFileSync(path.join(tree, EMPTY_STATE_FILE), "utf8");
    expect(patched).toContain(EMPTY_STATE_REPLACE);
    expect(patched).not.toContain(EMPTY_STATE_FIND);
    expect(patched).toContain("No conversations yet.");
    expect(patched).toContain('data-testid="chatsEmpty"');
    expect(() => applyFixturePatch(tree, problem)).toThrow(/exactly once/);
  });

  it("probes session.ts with a named export", () => {
    const tree = tempDir("vibeware-probe-");
    const relDir = path.join(tree, "src/services/link");
    mkdirSync(relDir, { recursive: true });
    writeFileSync(path.join(tree, SESSION_FILE), "export function signOut() {}\n");
    expect(applySessionProbe(tree)).toBe(SESSION_FILE);
    expect(readFileSync(path.join(tree, SESSION_FILE), "utf8")).toContain(SESSION_PROBE_EXPORT);
  });

  it("accepts chats-page-only and rejects session.ts against this repo manifest", () => {
    const manifest = loadManifestFile(path.join(ROOT, "vibeware.yaml"));
    const problem = loadProblem(FIXTURE);
    const scope = resolveScope(manifest, "hc-chats-ui", problem);
    expect(scope.writable_paths).toEqual([EMPTY_STATE_FILE]);
    expect(scope.forbidden_paths).toContain(SESSION_FILE);
    expect(evaluateChangedFiles(manifest, "hc-chats-ui", [EMPTY_STATE_FILE]).ok).toBe(true);
    const rejected = evaluateChangedFiles(manifest, "hc-chats-ui", [SESSION_FILE]);
    expect(rejected.ok).toBe(false);
    expect(rejected.rejected[0]).toEqual(
      expect.objectContaining({ path: SESSION_FILE, reason: "forbidden" }),
    );
  });
});

describe("vibeware sandbox safety scans", () => {
  it("strips GitHub/Vercel/Railway/staging-invite secrets from the child env", () => {
    const cleaned = stripSecretsFromEnv({
      PATH: "/usr/bin",
      GH_TOKEN: "secret",
      GITHUB_TOKEN: "secret",
      VERCEL_TOKEN: "secret",
      VERCEL_ORG_ID: "secret",
      RAILWAY_TOKEN: "secret",
      STAGING_SIGNUP_TOKEN: "secret",
      STAGING_INVITE_PASSWORD: "secret",
      NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN: "secret",
      HYPERCOLOR_READ_TOKEN: "secret",
    });
    for (const key of SANDBOX_STRIP_ENV) {
      expect(cleaned[key]).toBeUndefined();
    }
    expect(cleaned.PATH).toBe("/usr/bin");
  });

  it("flags new dangerouslySetInnerHTML or eval( on added diff lines only", () => {
    expect(scanDiffForDanger("+ const html = dangerouslySetInnerHTML\n")).toEqual([
      "dangerouslySetInnerHTML",
    ]);
    expect(scanDiffForDanger("+ eval(user)\n")).toEqual(["eval("]);
    expect(scanDiffForDanger("- dangerouslySetInnerHTML\n- eval(old)\n+ const ok = 1\n")).toEqual([]);
    expect(addedLines("+++ a\n+hello\n-old\n").join("")).toBe("+hello");
  });

  it("treats telemetry allowlist, vibeware.yaml, and CI as boundary files", () => {
    expect(boundaryViolations(["src/components/chats-page.tsx"])).toEqual([]);
    expect(boundaryViolations(["vibeware.yaml", ".github/workflows/ci.yml"])).toEqual([
      "vibeware.yaml",
      ".github/workflows/ci.yml",
    ]);
    expect(boundaryViolations(["src/services/vibeware/collector.ts"])).toEqual([
      "src/services/vibeware/collector.ts",
    ]);
  });

  it("refuses candidate artifacts that contain a pubky id", () => {
    const pubky = "ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u";
    expect(containsPubkyId(`x ${pubky} y`)).toBe(true);
    expect(() => assertArtifactSafe("candidate.json", `{"id":"${pubky}"}`)).toThrow(/pubky/);
    expect(() =>
      assertArtifactSafe("candidate.json", buildCandidate({
        surface: "hc-chats-ui",
        baseSha: "abc",
        scope: { writable_paths: [EMPTY_STATE_FILE], forbidden_paths: [SESSION_FILE], source: "vibeware.yaml" },
        files: [EMPTY_STATE_FILE],
        explanation: "ok",
        rollback: "ok",
        tests: [],
        validation: { ok: true },
        probeSession: false,
        rejected: [],
        worktree: null,
        keep: false,
      })),
    ).not.toThrow();
  });
});

describe("vibeware sandbox CLI dry-run", () => {
  it("writes an in-scope candidate and removes the worktree", () => {
    const out = tempDir("vibeware-out-ok-");
    const result = spawnSync(
      process.execPath,
      [
        SANDBOX,
        "--surface",
        "hc-chats-ui",
        "--problem",
        "fixtures/vibeware/empty-state-problem.json",
        "--out",
        out,
        "--skip-validate",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const candidatePath = path.join(out, "candidate.json");
    expect(existsSync(candidatePath)).toBe(true);
    const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
    expect(candidate.surface).toBe("hc-chats-ui");
    expect(candidate.files).toEqual([EMPTY_STATE_FILE]);
    expect(candidate.mode).toBe("in-scope");
    expect(candidate.worktree).toBeNull();
    const diff = readFileSync(path.join(out, "candidate.diff"), "utf8");
    expect(diff).toContain(EMPTY_STATE_REPLACE);
    expect(diff).not.toContain(SESSION_FILE);
    expect(readFileSync(path.join(ROOT, EMPTY_STATE_FILE), "utf8")).toContain(EMPTY_STATE_FIND);
    const leftover = spawnSync("git", ["worktree", "list", "--porcelain"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(leftover.stdout).not.toMatch(/vibeware-sandbox-/);
  }, 30_000);

  it("rejects a session.ts probe", () => {
    const out = tempDir("vibeware-out-bad-");
    const result = spawnSync(
      process.execPath,
      [
        SANDBOX,
        "--surface",
        "hc-chats-ui",
        "--problem",
        "fixtures/vibeware/empty-state-problem.json",
        "--out",
        out,
        "--probe-session",
        "--skip-validate",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/session\.ts\tforbidden/);
    const candidate = JSON.parse(readFileSync(path.join(out, "candidate.json"), "utf8"));
    expect(candidate.mode).toBe("probe-session");
    expect(candidate.files).toEqual(expect.arrayContaining([EMPTY_STATE_FILE, SESSION_FILE]));
    expect(candidate.rejected.some((item) => item.path === SESSION_FILE && item.reason === "forbidden")).toBe(
      true,
    );
    expect(readFileSync(path.join(ROOT, SESSION_FILE), "utf8")).not.toContain("VIBEWARE_SANDBOX_PROBE");
  }, 30_000);
});
