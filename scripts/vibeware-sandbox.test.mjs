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
  playwrightBrowsersAvailable,
  resolveScope,
  resolveWorktreePath,
  runPathPolicy,
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

function writeTmpProblem(targetFile, find, replace) {
  const dir = tempDir("vibeware-problem-tmp-");
  const file = path.join(dir, "problem.json");
  writeFileSync(
    file,
    JSON.stringify({
      status: "qualified",
      surface: "hc-chats-ui",
      evidence_refs: ["ev_tmp_0001"],
      problem: {
        target_file: targetFile,
        find,
        replace,
      },
    }),
  );
  return file;
}

function committedFile(rel) {
  const result = spawnSync("git", ["show", `HEAD:${rel}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git show HEAD:${rel} failed: ${(result.stderr || "").trim()}`);
  }
  return result.stdout;
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
    writeFileSync(path.join(tree, EMPTY_STATE_FILE), committedFile(EMPTY_STATE_FILE));
    const problem = loadProblem(FIXTURE);
    expect(applyFixturePatch(tree, problem)).toBe(EMPTY_STATE_FILE);
    const patched = readFileSync(path.join(tree, EMPTY_STATE_FILE), "utf8");
    expect(patched).toContain(EMPTY_STATE_REPLACE);
    expect(patched).not.toContain(EMPTY_STATE_FIND);
    expect(patched).toContain("Add someone by pubky, then start a chat.");
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

  it("rejects a traversing target_file before any write", () => {
    const tree = tempDir("vibeware-trav-");
    const beforeSession = readFileSync(path.join(ROOT, SESSION_FILE), "utf8");
    const beforeChats = readFileSync(path.join(ROOT, EMPTY_STATE_FILE), "utf8");
    expect(() =>
      applyFixturePatch(tree, {
        problem: {
          target_file: "../../src/services/link/session.ts",
          find: 'const DB_NAME = "hypercolor-session";',
          replace: 'const DB_NAME = "vibeware-pwned-session";',
        },
      }),
    ).toThrow(/unsafe path|dot-segment|escapes worktree/);
    expect(() =>
      resolveWorktreePath(tree, "../../src/services/link/session.ts"),
    ).toThrow(/unsafe path|dot-segment|escapes worktree/);
    expect(readFileSync(path.join(ROOT, SESSION_FILE), "utf8")).toBe(beforeSession);
    expect(readFileSync(path.join(ROOT, EMPTY_STATE_FILE), "utf8")).toBe(beforeChats);
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
      GITHUB_PRIVATE_KEY: "secret",
      GH_ENTERPRISE_TOKEN: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
      NPM_TOKEN: "secret",
      NODE_AUTH_TOKEN: "secret",
      NODE_ENV: "test",
      NODE_OPTIONS: "--max-old-space-size=512",
      NODE_PATH: "/usr/lib/node",
      npm_config_user_agent: "npm/10",
      npm_lifecycle_event: "test",
      "npm_config_//registry.npmjs.org/:_authToken": "secret",
    });
    for (const key of SANDBOX_STRIP_ENV) {
      expect(cleaned[key]).toBeUndefined();
    }
    expect(cleaned.GITHUB_PRIVATE_KEY).toBeUndefined();
    expect(cleaned.GH_ENTERPRISE_TOKEN).toBeUndefined();
    expect(cleaned.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(cleaned.NPM_TOKEN).toBeUndefined();
    expect(cleaned["npm_config_//registry.npmjs.org/:_authToken"]).toBeUndefined();
    expect(cleaned.PATH).toBe("/usr/bin");
    expect(cleaned.NODE_ENV).toBe("test");
    expect(cleaned.NODE_OPTIONS).toBe("--max-old-space-size=512");
    expect(cleaned.NODE_PATH).toBe("/usr/lib/node");
    expect(cleaned.npm_config_user_agent).toBe("npm/10");
    expect(cleaned.npm_lifecycle_event).toBe("test");
  });

  it("does not expose stripped secrets to a child command", () => {
    const env = stripSecretsFromEnv({
      PATH: process.env.PATH,
      NODE_ENV: "test",
      GITHUB_PRIVATE_KEY: "secret",
      GH_ENTERPRISE_TOKEN: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
      NPM_TOKEN: "secret",
    });
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        [
          "if (process.env.GITHUB_PRIVATE_KEY) process.exit(2);",
          "if (process.env.GH_ENTERPRISE_TOKEN) process.exit(3);",
          "if (process.env.AWS_SECRET_ACCESS_KEY) process.exit(4);",
          "if (process.env.NPM_TOKEN) process.exit(5);",
          "if (process.env.NODE_ENV !== 'test') process.exit(6);",
          "if (!process.env.PATH) process.exit(7);",
        ].join(""),
      ],
      { encoding: "utf8", env },
    );
    expect(result.status).toBe(0);
  });

  it("passes the stripped env into the playwright version probe", () => {
    const env = stripSecretsFromEnv({
      PATH: process.env.PATH,
      NODE_ENV: "test",
      GITHUB_PRIVATE_KEY: "must-not-leak",
    });
    expect(typeof playwrightBrowsersAvailable(env)).toBe("boolean");
  });

  it("flags new dangerouslySetInnerHTML or eval( on added diff lines only", () => {
    expect(scanDiffForDanger("+ const html = dangerouslySetInnerHTML\n")).toEqual([
      "dangerouslySetInnerHTML",
    ]);
    expect(scanDiffForDanger("+ eval(user)\n")).toEqual(["eval("]);
    expect(scanDiffForDanger("- dangerouslySetInnerHTML\n- eval(old)\n+ const ok = 1\n")).toEqual([]);
    expect(addedLines("+++ a\n+hello\n-old\n").join("")).toBe("+hello");
  });

  it("flags injected onError= and <script on added diff lines", () => {
    expect(scanDiffForDanger('+ <img src=x onError="evil"\n')).toContain("on*=");
    expect(scanDiffForDanger("+ const x = <script>alert(1)</script>\n")).toContain("<script");
    expect(scanDiffForDanger("+ href={javascript:alert(1)}\n")).toContain("javascript:");
    expect(scanDiffForDanger("+ const f = new Function('x')\n")).toContain("new Function");
    expect(scanDiffForDanger("+ node.innerHTML = html\n")).toContain("innerHTML");
    expect(scanDiffForDanger("+ node.outerHTML = html\n")).toContain("outerHTML");
    expect(scanDiffForDanger("+ document.write(html)\n")).toContain("document.write");
    expect(scanDiffForDanger("+ <iframe srcDoc={html}\n")).toContain("srcDoc");
    expect(scanDiffForDanger("- <script>old</script>\n- onError=old\n+ const ok = 1\n")).toEqual([]);
  });

  it("flags lowercase handlers, window.eval, Function(, and string-arg timers", () => {
    expect(scanDiffForDanger('+ <button onclick="evil()">Go</button>\n')).toContain("on*=");
    expect(scanDiffForDanger("+ window.eval(payload)\n")).toContain("eval(");
    expect(scanDiffForDanger("+ const f = Function('return 1')\n")).toContain("Function(");
    expect(scanDiffForDanger('+ setTimeout("evil()", 0)\n')).toContain("setTimeout(");
    expect(scanDiffForDanger("+ setInterval('evil()', 1000)\n")).toContain("setTimeout(");
    expect(
      scanDiffForDanger("+ <Button type=\"button\" size=\"sm\" onClick={() => onStartChat()}>New chat</Button>\n"),
    ).toEqual([]);
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

  it("grades path policy from the repo-root manifest, not a worktree rewrite", () => {
    const worktree = tempDir("vibeware-manifest-");
    writeFileSync(
      path.join(worktree, "vibeware.yaml"),
      "surfaces: []\nforbidden_paths: []\n",
    );
    const policy = runPathPolicy({
      repoRoot: ROOT,
      worktree,
      surface: "hc-chats-ui",
      files: [SESSION_FILE],
      env: stripSecretsFromEnv(process.env),
    });
    expect(policy.ok).toBe(false);
    expect(
      policy.rejected.some((item) => item.path === SESSION_FILE && item.reason === "forbidden"),
    ).toBe(true);
  });

  it("refuses candidate artifacts that contain a pubky id", () => {
    const pubky = "ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u";
    expect(containsPubkyId(`x ${pubky} y`)).toBe(true);
    expect(() => assertArtifactSafe("candidate.json", `{"id":"${pubky}"}`)).toThrow(/pubky/);
    expect(() =>
      assertArtifactSafe("candidate.json", buildCandidate({
        surface: "hc-chats-ui",
        baseSha: "581447d05cf956ba8c9a7028aad94c28b08eb6f7",
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

  it("rejects a planted credentialed URL in an excerpt", () => {
    expect(() =>
      assertArtifactSafe("excerpt", "npm failed at https://user:pass@host/v1/push"),
    ).toThrow(/credentialed URLs/);
    expect(() =>
      assertArtifactSafe("excerpt", "key=AKIAIOSFODNN7EXAMPLE"),
    ).toThrow(/AWS-style access keys/);
    expect(() =>
      assertArtifactSafe(
        "excerpt",
        "seed=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ),
    ).toThrow(/long hex secrets/);
  });
});

describe("vibeware sandbox CLI dry-run", () => {
  it.skipIf(process.env.VIBEWARE_SANDBOX_INNER === "1")(
    "writes an in-scope candidate and removes the worktree",
    () => {
      const out = tempDir("vibeware-out-ok-");
      const beforeChats = readFileSync(path.join(ROOT, EMPTY_STATE_FILE), "utf8");
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
      expect(readFileSync(path.join(ROOT, EMPTY_STATE_FILE), "utf8")).toBe(beforeChats);
      expect(committedFile(EMPTY_STATE_FILE)).toContain(EMPTY_STATE_FIND);
      const leftover = spawnSync("git", ["worktree", "list", "--porcelain"], {
        cwd: ROOT,
        encoding: "utf8",
      });
      expect(leftover.stdout).not.toMatch(/vibeware-sandbox-/);
    },
    60_000,
  );

  it.skipIf(process.env.VIBEWARE_SANDBOX_INNER === "1")(
    "rejects a session.ts probe",
    () => {
      const out = tempDir("vibeware-out-bad-");
      const beforeSession = readFileSync(path.join(ROOT, SESSION_FILE), "utf8");
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
      expect(
        candidate.rejected.some((item) => item.path === SESSION_FILE && item.reason === "forbidden"),
      ).toBe(true);
      expect(readFileSync(path.join(ROOT, SESSION_FILE), "utf8")).toBe(beforeSession);
    },
    60_000,
  );

  it.skipIf(process.env.VIBEWARE_SANDBOX_INNER === "1")(
    "rejects a traversing target_file and does not touch main",
    () => {
      const out = tempDir("vibeware-out-trav-");
      const beforeSession = readFileSync(path.join(ROOT, SESSION_FILE), "utf8");
      const beforeChats = readFileSync(path.join(ROOT, EMPTY_STATE_FILE), "utf8");
      const problem = writeTmpProblem(
        "../../src/services/link/session.ts",
        'const DB_NAME = "hypercolor-session";',
        'const DB_NAME = "vibeware-pwned-session";',
      );
      const result = spawnSync(
        process.execPath,
        [
          SANDBOX,
          "--surface",
          "hc-chats-ui",
          "--problem",
          problem,
          "--out",
          out,
          "--skip-validate",
        ],
        {
          cwd: ROOT,
          encoding: "utf8",
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/unsafe path|dot-segment|escapes worktree/);
      expect(readFileSync(path.join(ROOT, SESSION_FILE), "utf8")).toBe(beforeSession);
      expect(readFileSync(path.join(ROOT, EMPTY_STATE_FILE), "utf8")).toBe(beforeChats);
      expect(beforeSession).toContain('const DB_NAME = "hypercolor-session";');
      expect(beforeSession).not.toContain("vibeware-pwned-session");
      const leftover = spawnSync("git", ["worktree", "list", "--porcelain"], {
        cwd: ROOT,
        encoding: "utf8",
      });
      expect(leftover.stdout).not.toMatch(/vibeware-sandbox-/);
    },
    60_000,
  );

  it.skipIf(process.env.VIBEWARE_SANDBOX_INNER === "1")(
    "fails the run when the fixture injects onError= or <script",
    () => {
      const out = tempDir("vibeware-out-xss-");
      const beforeChats = readFileSync(path.join(ROOT, EMPTY_STATE_FILE), "utf8");
      const problem = writeTmpProblem(
        EMPTY_STATE_FILE,
        EMPTY_STATE_FIND,
        'Start a chat <script>x</script> onclick=evil',
      );
      const result = spawnSync(
        process.execPath,
        [
          SANDBOX,
          "--surface",
          "hc-chats-ui",
          "--problem",
          problem,
          "--out",
          out,
          "--skip-validate",
        ],
        {
          cwd: ROOT,
          encoding: "utf8",
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/<script|on\*=/);
      expect(readFileSync(path.join(ROOT, EMPTY_STATE_FILE), "utf8")).toBe(beforeChats);
    },
    30_000,
  );
});
