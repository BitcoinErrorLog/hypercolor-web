#!/usr/bin/env node
/**
 * After `next build`, mark a harness-enabled export so `preview:static`
 * cannot serve it as production.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = ".e2e-harness";

if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") {
  process.exit(0);
}

const out = path.join(REPO_ROOT, "out");
if (!existsSync(out)) {
  process.exit(0);
}

writeFileSync(path.join(out, MARKER), "NEXT_PUBLIC_E2E_HARNESS=1\n");
console.log(`mark-e2e-export: wrote ${path.join(out, MARKER)}`);
