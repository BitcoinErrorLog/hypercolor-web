import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { E2E_HARNESS_MARKER, markE2eExport } from "./mark-e2e-export.mjs";

const temps = [];

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop(), { recursive: true, force: true });
  }
});

function tempRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "hc-mark-e2e-"));
  temps.push(root);
  mkdirSync(path.join(root, "out"));
  return root;
}

describe("markE2eExport", () => {
  it("writes .e2e-harness when the harness build is enabled", () => {
    const root = tempRepo();
    const result = markE2eExport({ root, harness: true });
    expect(result.action).toBe("wrote");
    expect(existsSync(path.join(root, "out", E2E_HARNESS_MARKER))).toBe(true);
    expect(readFileSync(path.join(root, "out", E2E_HARNESS_MARKER), "utf8")).toContain(
      "NEXT_PUBLIC_E2E_HARNESS=1",
    );
  });

  it("removes a stale .e2e-harness on a production build", () => {
    const root = tempRepo();
    writeFileSync(path.join(root, "out", E2E_HARNESS_MARKER), "NEXT_PUBLIC_E2E_HARNESS=1\n");
    const result = markE2eExport({ root, harness: false });
    expect(result.action).toBe("removed");
    expect(existsSync(path.join(root, "out", E2E_HARNESS_MARKER))).toBe(false);
  });
});
