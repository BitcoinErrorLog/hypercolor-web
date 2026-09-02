import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const REPO_ROOT = join(__dirname, "..");
const OUT = join(REPO_ROOT, "out");
const SCANNER = join(REPO_ROOT, "scripts", "e2e-harness-symbols.mjs");

type ScanHit = {
  file: string;
  symbol: string;
  kind: "absent" | "live" | "inert";
  gated: boolean;
};

test("production out/ contains no live __hypercolor hook registration", () => {
  test.skip(!existsSync(OUT), "run npm run build to produce production out/");
  expect(existsSync(join(OUT, ".e2e-harness"))).toBe(false);
  const report = JSON.parse(
    execFileSync(process.execPath, [SCANNER, "scan", OUT], { encoding: "utf8" }),
  ) as { symbols: string[]; hits: ScanHit[] };
  expect(report.symbols.length).toBeGreaterThan(0);
  for (const hit of report.hits) {
    if (hit.kind === "absent" || hit.kind === "inert") continue;
    expect(hit.gated, `${hit.symbol} assigned in ${hit.file} without a harness env gate`).toBe(
      true,
    );
  }
});
