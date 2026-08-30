import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateChangedFiles,
  globToRegExp,
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
import { isCandidateBranchName, parseCandidateSurface } from "./check-vibeware-pr.mjs";
import { resolveSpecifier, scanWritableFile } from "./check-vibeware-writable-imports.mjs";

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
        outcome: "ok",
        kind: "text",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a planted body field", () => {
    const result = validateEvidencePayload("app.thread.send_settled", {
      channel: "dm",
      outcome: "ok",
      kind: "text",
      body: "hi",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("banned_key");
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
    expect(isCandidateBranchName("feat/vibeware-docs")).toBe(false);
  });

  it("parses a surface marker", () => {
    expect(parseCandidateSurface("surface: hc-chats-ui\n")).toBe("hc-chats-ui");
    expect(parseCandidateSurface("surface: hc-thread-ui")).toBe("hc-thread-ui");
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
});
