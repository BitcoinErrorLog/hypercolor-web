#!/usr/bin/env node
/**
 * Clean rebuild of the static export with `NEXT_PUBLIC_E2E_HARNESS=1` into
 * `out-e2e/`. Production `out/` is left alone (stashed around the build).
 */
import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO_ROOT, "out");
const OUT_E2E = path.join(REPO_ROOT, "out-e2e");
const STASH = path.join(REPO_ROOT, ".out-prod-stash");
const MARKER = ".e2e-harness";

function restoreProdOut(stashed) {
  if (!stashed) return;
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  if (existsSync(STASH)) renameSync(STASH, OUT);
}

rmSync(OUT_E2E, { recursive: true, force: true });
rmSync(STASH, { recursive: true, force: true });

let stashed = false;
if (existsSync(OUT)) {
  renameSync(OUT, STASH);
  stashed = true;
}

const result = spawnSync("npm", ["run", "build"], {
  cwd: REPO_ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_E2E_HARNESS: "1",
  },
});

if (result.status !== 0) {
  restoreProdOut(stashed);
  process.exit(result.status ?? 1);
}

if (!existsSync(OUT)) {
  restoreProdOut(stashed);
  console.error("build:e2e:static: next build did not write out/");
  process.exit(1);
}

writeFileSync(path.join(OUT, MARKER), "NEXT_PUBLIC_E2E_HARNESS=1\n");
renameSync(OUT, OUT_E2E);
restoreProdOut(stashed);
console.log(`build:e2e:static: wrote ${OUT_E2E} with ${MARKER}`);
