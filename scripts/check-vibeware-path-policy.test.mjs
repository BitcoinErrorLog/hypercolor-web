import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateChangedFiles,
  globToRegExp,
  loadManifestFile,
  normalizePath,
  pathMatches,
  V1_EVIDENCE_ALLOWLIST,
} from "./check-vibeware-path-policy.mjs";

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

  it("rejects session.ts for hc-chats-ui", () => {
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
  });

  it("rejects a change to vibeware.yaml", () => {
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
    expect(manifest.forbidden_paths).toContain("src/lib/group-invites.ts");
    expect(manifest.forbidden_paths).toContain("scripts/check-vibeware-path-policy*");
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

  it("matches check-vibeware-path-policy* without matching the selftest", () => {
    expect(
      pathMatches("scripts/check-vibeware-path-policy*", "scripts/check-vibeware-path-policy"),
    ).toBe(true);
    expect(
      pathMatches("scripts/check-vibeware-path-policy*", "scripts/check-vibeware-path-policy.mjs"),
    ).toBe(true);
    expect(
      pathMatches(
        "scripts/check-vibeware-path-policy*",
        "scripts/check-vibeware-path-policy.test.mjs",
      ),
    ).toBe(true);
    expect(
      pathMatches("scripts/check-vibeware-path-policy*", "scripts/check-vibeware-selftest.mjs"),
    ).toBe(false);
  });

  it("normalizes ./ and backslashes before matching", () => {
    expect(normalizePath("./src/components/chats-page.tsx")).toBe("src/components/chats-page.tsx");
    expect(pathMatches("src/types/**", "src\\types\\link.ts")).toBe(true);
    expect(globToRegExp("a*b").test("aXb")).toBe(true);
    expect(globToRegExp("a*b").test("a/X/b")).toBe(false);
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
      "src/foo.ts",
    ]);
  });
});
