#!/usr/bin/env node
/**
 * After `next build`, mark a harness-enabled export so `preview:static`
 * cannot serve it as production. On a production build, remove any stale
 * marker left from a prior harness export that shared `out/`.
 */
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_HARNESS_MARKER = ".e2e-harness";

/**
 * @param {{ root?: string, harness?: boolean }} [options]
 */
export function markE2eExport(options = {}) {
  const root =
    options.root ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const harness =
    options.harness ?? process.env.NEXT_PUBLIC_E2E_HARNESS === "1";
  const out = path.join(root, "out");
  const markerPath = path.join(out, E2E_HARNESS_MARKER);

  if (!existsSync(out)) {
    return { action: "noop-missing-out", markerPath };
  }

  if (harness) {
    writeFileSync(markerPath, "NEXT_PUBLIC_E2E_HARNESS=1\n");
    return { action: "wrote", markerPath };
  }

  if (existsSync(markerPath)) {
    unlinkSync(markerPath);
    return { action: "removed", markerPath };
  }

  return { action: "noop-clean", markerPath };
}

const isMain =
  process.argv[1] !== undefined &&
  path.normalize(fileURLToPath(import.meta.url)) ===
    path.normalize(path.resolve(process.argv[1]));

if (isMain) {
  const result = markE2eExport();
  if (result.action === "wrote") {
    console.log(`mark-e2e-export: wrote ${result.markerPath}`);
  } else if (result.action === "removed") {
    console.log(`mark-e2e-export: removed stale ${result.markerPath}`);
  }
}
