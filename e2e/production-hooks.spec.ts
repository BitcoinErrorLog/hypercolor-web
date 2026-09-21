import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const REPO_ROOT = join(__dirname, "..");
const OUT = join(REPO_ROOT, "out");
const NEXT_STATIC = join(REPO_ROOT, ".next", "static");
const SCANNER = join(REPO_ROOT, "scripts", "e2e-harness-symbols.mjs");

function productionClientRoot(): string | null {
  if (existsSync(OUT)) return OUT;
  if (existsSync(NEXT_STATIC)) return NEXT_STATIC;
  return null;
}

type ScanHit = {
  file: string;
  symbol: string;
  kind: "absent" | "live" | "inert";
  gated: boolean;
};

test("production client output contains no live __hypercolor hook registration", () => {
  const root = productionClientRoot();
  if (!root) {
    if (process.env.HYPERCOLOR_ASSERT_PRODUCTION_OUT === "1") {
      throw new Error(
        "production client output is missing — run npm run build before this assertion",
      );
    }
    test.skip(true, "run npm run build to produce production client output");
    return;
  }
  if (root === OUT) {
    expect(existsSync(join(OUT, ".e2e-harness"))).toBe(false);
  }
  const report = JSON.parse(
    execFileSync(process.execPath, [SCANNER, "scan", root], { encoding: "utf8" }),
  ) as { symbols: string[]; hits: ScanHit[] };
  expect(report.symbols.length).toBeGreaterThan(0);
  const live = report.hits.filter((hit) => hit.kind === "live");
  // Positive invariant: production export ships zero live harness hooks.
  expect(live, live.map((h) => `${h.symbol} in ${h.file}`).join(", ")).toEqual([]);
  // Secondary diagnostic: if anything were live, it must still be env-gated.
  for (const hit of live) {
    expect(hit.gated, `${hit.symbol} assigned in ${hit.file} without a harness env gate`).toBe(
      true,
    );
  }
});
