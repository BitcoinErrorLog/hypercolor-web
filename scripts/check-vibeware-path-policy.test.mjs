import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateChangedFiles,
  globToRegExp,
  assertCiPrGateOrder,
  loadManifest,
  loadManifestFile,
  MIN_SHARED_FORBIDDEN_PATHS,
  normalizePath,
  parseYaml,
  pathMatches,
  REQUIRED_SHARED_FORBIDDEN,
  UnsafePathError,
  V1_EVIDENCE_ALLOWLIST,
  validateEvidencePayload,
} from "./check-vibeware-path-policy.mjs";
import { evaluatePullRequest, isCandidateBranchName, parseCandidateSurface } from "./check-vibeware-pr.mjs";
import { resolveSpecifier, scanWritableFile, checkWritableImports } from "./check-vibeware-writable-imports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "vibeware.yaml");

function check(surfaceId, files) {
  return evaluateChangedFiles(loadManifestFile(MANIFEST), surfaceId, files);
}

describe("vibeware path policy", () => {
  it("accepts chats-page.tsx for hc-chats-ui", () => {
    const result = check("hc-chats-ui", ["src/components/chats-page.tsx"]);
    expect(result.ok).toBe(true);
    expect(result.rejected).toEqual([]);
  });

  it("rejects session.ts for hc-chats-ui with reason forbidden", () => {
    const result = check("hc-chats-ui", ["src/services/link/session.ts"]);
    expect(result.ok).toBe(false);
    expect(result.rejected.map((item) => item.path)).toEqual(["src/services/link/session.ts"]);
    expect(result.rejected[0]?.reason).toBe("forbidden");
  });

  it("rejects chats-page.tsx plus session.ts", () => {
    const result = check("hc-chats-ui", [
      "src/components/chats-page.tsx",
      "src/services/link/session.ts",
    ]);
    expect(result.ok).toBe(false);
    expect(result.rejected.map((item) => item.path)).toEqual(["src/services/link/session.ts"]);
    expect(result.rejected[0]?.reason).toBe("forbidden");
  });

  it("rejects a change to vibeware.yaml as forbidden", () => {
    const result = check("hc-chats-ui", ["vibeware.yaml"]);
    expect(result.ok).toBe(false);
    expect(result.rejected[0]?.reason).toBe("forbidden");
  });

  it("rejects the collector as forbidden", () => {
    const result = check("hc-chats-ui", ["src/services/vibeware/collector.ts"]);
    expect(result.ok).toBe(false);
    expect(result.rejected[0]?.reason).toBe("forbidden");
  });

  it("rejects attachment-bubble.tsx for hc-thread-ui", () => {
    const result = check("hc-thread-ui", ["src/components/attachment-bubble.tsx"]);
    expect(result.ok).toBe(false);
    expect(result.rejected.map((item) => item.path)).toEqual([
      "src/components/attachment-bubble.tsx",
    ]);
    expect(result.rejected[0]?.reason).toBe("forbidden");
  });

  it("rejects README.md as outside_writable", () => {
    const result = check("hc-chats-ui", ["README.md"]);
    expect(result.ok).toBe(false);
    expect(result.rejected[0]?.reason).toBe("outside_writable");
  });

  it("treats a file matching writable and forbidden as forbidden", () => {
    const manifest = loadManifestFile(MANIFEST);
    const chats = manifest.surfaces.find((surface) => surface.id === "hc-chats-ui");
    expect(chats).toBeTruthy();
    const overlapped = {
      ...manifest,
      surfaces: [
        {
          ...chats,
          writable_paths: ["src/services/link/session.ts", "src/components/chats-page.tsx"],
          forbidden_paths: [],
        },
      ],
    };
    const result = evaluateChangedFiles(overlapped, "hc-chats-ui", [
      "src/services/link/session.ts",
    ]);
    expect(result.ok).toBe(false);
    expect(result.rejected[0]?.reason).toBe("forbidden");
  });

  it("exits conceptually clean on an empty change set", () => {
    expect(check("hc-chats-ui", []).ok).toBe(true);
    expect(check("hc-chats-ui", ["", "  "]).ok).toBe(true);
  });

  it("loads the three surfaces and the v1 evidence allowlist", () => {
    const manifest = loadManifestFile(MANIFEST);
    expect(manifest.evidence_allowlist).toEqual(V1_EVIDENCE_ALLOWLIST);
    expect(manifest.surfaces.map((surface) => surface.id)).toEqual([
      "hc-chats-ui",
      "hc-thread-ui",
      "hc-onboarding-ui",
    ]);
    expect(manifest.forbidden_paths.length).toBeGreaterThanOrEqual(MIN_SHARED_FORBIDDEN_PATHS);
    for (const required of REQUIRED_SHARED_FORBIDDEN) {
      expect(manifest.forbidden_paths).toContain(required);
    }
    expect(manifest.forbidden_paths).toContain("src/lib/group-invites.ts");
    expect(manifest.forbidden_paths).toContain("src/services/backup/**");
    expect(manifest.forbidden_paths).toContain("src/services/onboarding/enableActions.tsx");
    expect(manifest.forbidden_paths).toContain("package.json");
    expect(manifest.forbidden_paths).toContain("package-lock.json");
    expect(manifest.forbidden_paths).toContain("src/hooks/useInbox.ts");
    expect(manifest.forbidden_paths).toContain("src/hooks/useChannel.ts");
    expect(manifest.forbidden_paths).toContain("src/hooks/useSignOut.ts");
    expect(manifest.forbidden_paths).toContain("scripts/copy-sqlite-wasm.mjs");
    expect(manifest.forbidden_paths).toContain("src/services/contacts/addManualContact.ts");
    expect(manifest.forbidden_paths).toContain("src/services/group/GroupService.ts");
    expect(manifest.forbidden_paths).toContain("src/services/StorageService.ts");
    expect(manifest.forbidden_paths).toContain("src/stores/inboxStore.ts");
    expect(manifest.forbidden_paths).toContain("src/services/vibeware/**");
    expect(manifest.surfaces[0]?.writable_paths).toEqual(["src/components/chats-page.tsx"]);
    expect(manifest.surfaces[0]?.forbidden_paths).toContain("src/stores/inboxStore.ts");
    expect(manifest.surfaces[1]?.writable_paths).toEqual([
      "src/components/thread-view.tsx",
      "src/components/composer.tsx",
      "src/components/message-bubble.tsx",
    ]);
    expect(manifest.surfaces[2]?.kill_switch).toEqual({
      flag: "hc-onboarding-ui-vibeware-enabled",
    });
    expect(manifest.surfaces[0]?.autonomy).toEqual({
      max_level: "expose",
      auto_merge: false,
      auto_promote: false,
    });
    expect(manifest.surfaces[0]?.exposure.max_initial_percent).toBe(10);
    expect(manifest.surfaces[0]?.exposure.requires_human_for_percent_over).toBe(25);
  });

  it("fails load when shared forbidden_paths is emptied", () => {
    const text = readFileSync(MANIFEST, "utf8").replace(
      /^forbidden_paths:\n(?: {2}- .+\n)+/m,
      "forbidden_paths: []\n",
    );
    expect(() => loadManifest(text)).toThrow(/forbidden_paths/);
  });

  it("fails load when evidence_allowlist drifts from the frozen list", () => {
    const text = readFileSync(MANIFEST, "utf8").replace(
      "  - app.pwa.installed\n",
      "  - app.pwa.installed\n  - app.secret.dump\n",
    );
    expect(() => loadManifest(text)).toThrow(/evidence_allowlist/);
  });
});

describe("vibeware globs", () => {
  it("matches ** trees and exact paths", () => {
    expect(pathMatches("src/types/**", "src/types/link.ts")).toBe(true);
    expect(pathMatches("src/types/**", "src/types")).toBe(true);
    expect(pathMatches("src/types/**", "src/types/nested/a.ts")).toBe(true);
    expect(pathMatches("src/types/**", "src/typical.ts")).toBe(false);
    expect(pathMatches("vendor/paykit-wasm/**", "vendor/paykit-wasm/paykit_wasm.js")).toBe(true);
    expect(pathMatches(".github/**", ".github/workflows/ci.yml")).toBe(true);
    expect(pathMatches("src/services/payments/**", "src/services/payments/endpointValidation.ts")).toBe(
      true,
    );
    expect(pathMatches("src/components/chats-page.tsx", "src/components/chats-page.tsx")).toBe(true);
    expect(pathMatches("src/components/chats-page.tsx", "src/components/thread-view.tsx")).toBe(false);
  });

  it("matches check-vibeware* including the new PR and import scripts", () => {
    expect(pathMatches("scripts/check-vibeware*", "scripts/check-vibeware-path-policy")).toBe(true);
    expect(pathMatches("scripts/check-vibeware*", "scripts/check-vibeware-path-policy.mjs")).toBe(true);
    expect(
      pathMatches("scripts/check-vibeware*", "scripts/check-vibeware-path-policy.test.mjs"),
    ).toBe(true);
    expect(pathMatches("scripts/check-vibeware*", "scripts/check-vibeware-selftest.mjs")).toBe(true);
    expect(pathMatches("scripts/check-vibeware*", "scripts/check-vibeware-pr.mjs")).toBe(true);
    expect(pathMatches("scripts/check-vibeware*", "scripts/check-vibeware-writable-imports.mjs")).toBe(
      true,
    );
    expect(pathMatches("scripts/check-vibeware*", "scripts/vibeware-evidence.mjs")).toBe(false);
  });

  it("normalizes ./ and backslashes before matching", () => {
    expect(normalizePath("./src/components/chats-page.tsx")).toBe("src/components/chats-page.tsx");
    expect(pathMatches("src/types/**", "src\\types\\link.ts")).toBe(true);
    expect(globToRegExp("a*b").test("aXb")).toBe(true);
    expect(globToRegExp("a*b").test("a/X/b")).toBe(false);
  });

  it("rejects traversal even when a writable glob would match", () => {
    expect(() => normalizePath("src/components/../stores/inboxStore.ts")).toThrow(UnsafePathError);
    const manifest = loadManifestFile(MANIFEST);
    const chats = manifest.surfaces.find((surface) => surface.id === "hc-chats-ui");
    const synthetic = {
      ...manifest,
      surfaces: [{ ...chats, writable_paths: ["src/components/**"], forbidden_paths: [] }],
    };
    const result = evaluateChangedFiles(synthetic, "hc-chats-ui", [
      "src/components/../stores/inboxStore.ts",
    ]);
    expect(result.ok).toBe(false);
    expect(result.rejected[0]?.reason).toBe("unsafe_path");
  });

  it("rejects absolute paths and leftover backslashes", () => {
    expect(() => normalizePath("/src/components/chats-page.tsx")).toThrow(UnsafePathError);
    const result = evaluateChangedFiles(loadManifestFile(MANIFEST), "hc-chats-ui", [
      "/src/components/chats-page.tsx",
    ]);
    expect(result.rejected[0]?.reason).toBe("unsafe_path");
  });
});

describe("vibeware CLI helpers", () => {
  it("reads a changed-files list", async () => {
    const { readChangedFilesList } = await import("./check-vibeware-path-policy.mjs");
    const dir = mkdtempSync(path.join(tmpdir(), "vibeware-unit-"));
    const listPath = path.join(dir, "files");
    writeFileSync(listPath, "src/components/chats-page.tsx\n# comment\n\n./src/foo.ts\n");
    expect(readChangedFilesList(listPath)).toEqual([
      "src/components/chats-page.tsx",
      "./src/foo.ts",
    ]);
  });
});

describe("parseYaml safety", () => {
  it("throws on duplicate keys", () => {
    expect(() => parseYaml("foo: 1\nfoo: 2\n")).toThrow(/duplicate key/);
  });

  it("throws on anchors, aliases, and merge keys", () => {
    expect(() => parseYaml("foo: &x 1\n")).toThrow(/anchors/);
    expect(() => parseYaml("foo: *x\n")).toThrow(/aliases/);
    expect(() => parseYaml("<<: *x\n")).toThrow(/merge keys|aliases/);
  });

  it("strips # comments only outside quotes", () => {
    expect(parseYaml('foo: "bar # baz"\n')).toEqual({ foo: "bar # baz" });
    expect(parseYaml("foo: bar # baz\n")).toEqual({ foo: "bar" });
  });
});

describe("evidence payload schema", () => {
  it("allows an allowlisted event with only allowed fields", () => {
    expect(
      validateEvidencePayload("app.thread.send_settled", {
        channel: "dm",
        outcome: "sent",
        kind: "text",
      }),
    ).toEqual({ ok: true });
    expect(
      validateEvidencePayload("app.route.viewed", {
        route: "chats",
        from_route: "none",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a planted body field", () => {
    const result = validateEvidencePayload("app.thread.send_settled", {
      channel: "dm",
      outcome: "sent",
      kind: "text",
      body: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("banned_key");
  });

  it("rejects route secret message as invalid_value", () => {
    const result = validateEvidencePayload("app.route.viewed", {
      route: "secret message",
      from_route: "none",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_value");
    expect(result.key).toBe("route");
  });

  it("rejects nested objects and arrays in payloads", () => {
    expect(
      validateEvidencePayload("app.pwa.installed", { outcome: { accepted: true } }).reason,
    ).toBe("nested_value");
    expect(
      validateEvidencePayload("app.chat.empty_state", { kind: ["dms"] }).reason,
    ).toBe("nested_value");
  });

  it("rejects seed credential password and url keys", () => {
    expect(
      validateEvidencePayload("app.pwa.installed", { outcome: "accepted", seed: "x" }).reason,
    ).toBe("banned_key");
    expect(
      validateEvidencePayload("app.pwa.installed", { outcome: "accepted", credential: "x" }).reason,
    ).toBe("banned_key");
    expect(
      validateEvidencePayload("app.pwa.installed", { outcome: "accepted", password: "x" }).reason,
    ).toBe("banned_key");
    expect(
      validateEvidencePayload("app.pwa.installed", { outcome: "accepted", url: "https://x" }).reason,
    ).toBe("banned_key");
  });

  it("rejects an unknown event", () => {
    expect(validateEvidencePayload("app.secret.dump", { kind: "x" }).ok).toBe(false);
    expect(validateEvidencePayload("app.secret.dump", { kind: "x" }).reason).toBe("unknown_event");
  });

  it("rejects a pubky field", () => {
    const result = validateEvidencePayload("app.onboarding.state", {
      state: "enabled",
      pubky: "abc",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("banned_key");
  });

  it("rejects extra keys and missing keys", () => {
    expect(validateEvidencePayload("app.pwa.installed", { outcome: "ok", extra: 1 }).reason).toBe(
      "extra_keys",
    );
    expect(validateEvidencePayload("app.pwa.installed", {}).reason).toBe("missing_keys");
  });
});

describe("candidate detection", () => {
  it("treats vibeware/** and candidate/** as candidate branches", () => {
    expect(isCandidateBranchName("vibeware/hc-chats-ui")).toBe(true);
    expect(isCandidateBranchName("candidate/foo")).toBe(true);
    expect(isCandidateBranchName("main")).toBe(false);
    expect(isCandidateBranchName("p0/web-ci-green")).toBe(false);
    expect(isCandidateBranchName("feat/vibeware-docs")).toBe(false);
  });

  it("parses a surface marker", () => {
    expect(parseCandidateSurface("surface: hc-chats-ui\n")).toBe("hc-chats-ui");
    expect(parseCandidateSurface("surface: hc-thread-ui")).toBe("hc-thread-ui");
  });
});

describe("CI PR gate order", () => {
  it("places the PR gate step before npm ci", () => {
    const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(assertCiPrGateOrder(ci)).toBe(true);
    expect(ci.indexOf("check-vibeware-pr.mjs")).toBeLessThan(ci.search(/run:\s*npm ci\b/));
    expect(ci).not.toMatch(/\bpull_request_target\b/);
  });

  it("rejects a workflow that runs npm ci before the PR gates", () => {
    const unique =
      'VIBEWARE_BASE_DIR="${RUNNER_TEMP}/vibeware-base-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"';
    const reversed = [
      "name: Setup Node",
      "run: npm ci",
      "name: Extract base vibeware gate outside workspace",
      "name: Vibeware PR gates from base tree",
      "check-vibeware-pr.mjs",
      unique,
      unique,
    ].join("\n");
    expect(() => assertCiPrGateOrder(reversed)).toThrow(/before npm ci/);
  });

  it("requires a shared RUNNER_TEMP VIBEWARE_BASE_DIR assignment in both gate steps", () => {
    const missingDir = [
      "name: Setup Node",
      "name: Extract base vibeware gate outside workspace",
      "name: Vibeware PR gates from base tree",
      "check-vibeware-pr.mjs",
      "run: npm ci",
    ].join("\n");
    expect(() => assertCiPrGateOrder(missingDir)).toThrow(/VIBEWARE_BASE_DIR/);
  });

  it("rejects runner.temp interpolation", () => {
    const unique =
      'VIBEWARE_BASE_DIR="${RUNNER_TEMP}/vibeware-base-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"';
    const withRunner = [
      "name: Setup Node",
      "name: Extract base vibeware gate outside workspace",
      "name: Vibeware PR gates from base tree",
      "check-vibeware-pr.mjs",
      "run: npm ci",
      unique,
      unique,
      "VIBEWARE_BASE_DIR: ${{ runner.temp }}/vibeware-base",
    ].join("\n");
    expect(() => assertCiPrGateOrder(withRunner)).toThrow(/runner/);
  });
});

describe("writable import scan", () => {
  it("flags a forbidden import and planted telemetry identifiers", () => {
    const findings = scanWritableFile(
      `import { signOut } from "@/services/link/session";\nfetch("/t");\n`,
      "src/components/enable-page.tsx",
      ["src/services/link/session.ts"],
    );
    expect(findings.some((item) => item.reason === "forbidden_import")).toBe(true);
    expect(findings.some((item) => item.reason === "banned_identifier")).toBe(true);
  });

  it("resolves @/ specifiers into src/", () => {
    expect(resolveSpecifier("src/components/enable-page.tsx", "@/services/link/session")).toBe(
      "src/services/link/session.ts",
    );
  });

  it("flags a writable import of useInbox", () => {
    const findings = scanWritableFile(
      `import { useInbox } from "@/hooks/useInbox";\n`,
      "src/components/chats-page.tsx",
      ["src/hooks/useInbox.ts"],
    );
    expect(findings.some((item) => item.reason === "forbidden_import")).toBe(true);
  });

  it("flags require() of useInbox as forbidden_import", () => {
    const findings = scanWritableFile(
      `const { useInbox } = require("@/hooks/useInbox");\n`,
      "src/components/chats-page.tsx",
      ["src/hooks/useInbox.ts"],
    );
    expect(findings.some((item) => item.reason === "forbidden_import")).toBe(true);
  });

  it("flags a commented dynamic import of useInbox as forbidden_import", () => {
    const findings = scanWritableFile(
      `await import(/* comment */ "@/hooks/useInbox");\n`,
      "src/components/chats-page.tsx",
      ["src/hooks/useInbox.ts"],
    );
    expect(findings.some((item) => item.reason === "forbidden_import")).toBe(true);
  });

  it("flags a writable import of addManualContact as forbidden_import", () => {
    const findings = scanWritableFile(
      `import { addManualContact } from "@/services/contacts/addManualContact";\n`,
      "src/components/chats-page.tsx",
      ["src/services/contacts/addManualContact.ts"],
    );
    expect(findings.some((item) => item.reason === "forbidden_import")).toBe(true);
  });

  it("waives only the two pre-existing writable-surface couplings", () => {
    const result = checkWritableImports();
    expect(result.ok, JSON.stringify(result.findings)).toBe(true);
    const extra = scanWritableFile(
      `import { STANDBY_PRIMARY } from "@/services/link/provisionReceiver";\n`,
      "src/components/composer.tsx",
      ["src/services/link/provisionReceiver.ts"],
    );
    expect(extra.some((item) => item.reason === "forbidden_import")).toBe(true);
    const session = scanWritableFile(
      `import { signOut } from "@/services/link/session";\n`,
      "src/components/thread-view.tsx",
      ["src/services/link/session.ts"],
    );
    expect(session.some((item) => item.reason === "forbidden_import")).toBe(true);
  });

  it("keeps chats-page free of inbox orchestration", () => {
    const source = readFileSync(path.join(ROOT, "src/components/chats-page.tsx"), "utf8");
    expect(source).not.toMatch(/useInbox|addManualContact/);
  });
});

describe("honest evaluator vs rewritten candidate", () => {
  function git(cwd, args) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(
        `git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`,
      );
    }
    return result;
  }

  it("rejects a candidate that rewrites the evaluator and touches session.ts", () => {
    const fake = mkdtempSync(path.join(tmpdir(), "vibeware-f2-unit-"));
    git(fake, ["init"]);
    git(fake, ["config", "user.email", "vibeware@test"]);
    git(fake, ["config", "user.name", "vibeware"]);
    git(fake, ["config", "commit.gpgsign", "false"]);
    mkdirSync(path.join(fake, "scripts"), { recursive: true });
    mkdirSync(path.join(fake, "src/services/link"), { recursive: true });
    copyFileSync(MANIFEST, path.join(fake, "vibeware.yaml"));
    writeFileSync(path.join(fake, "scripts/check-vibeware-pr.mjs"), "console.log('honest');\n");
    writeFileSync(path.join(fake, "src/services/link/session.ts"), "export {}\n");
    git(fake, ["add", "-A"]);
    git(fake, ["commit", "-m", "base"]);
    const baseSha = git(fake, ["rev-parse", "HEAD"]).stdout.trim();
    git(fake, ["checkout", "-b", "vibeware/probe"]);
    mkdirSync(path.join(fake, ".vibeware"), { recursive: true });
    writeFileSync(path.join(fake, ".vibeware/candidate"), "surface: hc-chats-ui\n");
    writeFileSync(path.join(fake, "scripts/check-vibeware-pr.mjs"), "process.exit(0);\n");
    writeFileSync(path.join(fake, "src/services/link/session.ts"), "export const pwned = true;\n");
    git(fake, ["add", "-A"]);
    git(fake, ["commit", "-m", "rewrite evaluator and session"]);
    const headSha = git(fake, ["rev-parse", "HEAD"]).stdout.trim();

    const candidate = spawnSync(
      process.execPath,
      [path.join(fake, "scripts/check-vibeware-pr.mjs")],
      { encoding: "utf8" },
    );
    expect(candidate.status).toBe(0);

    const result = evaluatePullRequest({
      repoRoot: fake,
      baseSha,
      headSha,
      headRef: "vibeware/probe",
    });
    expect(result.ok).toBe(false);
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "scripts/check-vibeware-pr.mjs", reason: "forbidden" }),
        expect.objectContaining({ path: "src/services/link/session.ts", reason: "forbidden" }),
      ]),
    );
  });
});
