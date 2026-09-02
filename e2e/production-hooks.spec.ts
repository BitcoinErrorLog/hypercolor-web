import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  classifyHarnessHookInSource,
  findE2eHarnessHookSymbols,
  listE2eHarnessHookSymbols,
} from "../scripts/e2e-harness-symbols.mjs";

const REPO_ROOT = join(__dirname, "..");
const OUT = join(REPO_ROOT, "out");

test("production out/ contains no live __hypercolor hook registration", () => {
  test.skip(!existsSync(OUT), "run npm run build to produce production out/");
  expect(existsSync(join(OUT, ".e2e-harness"))).toBe(false);
  const symbols = listE2eHarnessHookSymbols(REPO_ROOT);
  expect(symbols.length).toBeGreaterThan(0);
  const hits = findE2eHarnessHookSymbols(OUT, symbols);
  for (const hit of hits) {
    const source = readFileSync(hit.file, "utf8");
    const kind = classifyHarnessHookInSource(source, hit.symbol);
    if (kind === "absent") continue;
    if (kind === "inert") continue;
    expect(
      source,
      `${hit.symbol} assigned in ${hit.file} without a harness env gate`,
    ).toMatch(/NEXT_PUBLIC_E2E_HARNESS/);
  }
});
