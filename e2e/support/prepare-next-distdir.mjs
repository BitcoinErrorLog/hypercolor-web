#!/usr/bin/env node
/**
 * Next 16 treats an absolute `distDir` as project-relative (`/tmp/foo` →
 * `<repo>/tmp/foo`) and does not scan a symlinked `app/` directory.
 * Run Next from `/tmp/hypercolor-ringsim-app`: copy `app` + `public` onto
 * the boot disk, symlink the rest, keep `.next` as a real /tmp directory.
 */
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LOCAL_APP = "/tmp/hypercolor-ringsim-app";
export const LOCAL_NEXT_DIST = join(LOCAL_APP, ".next");

const COPY_NAMES = ["app", "public", "next.config.ts", "tsconfig.json"];
const LINK_NAMES = [
  "src",
  "vendor",
  "node_modules",
  "package.json",
  "package-lock.json",
  "postcss.config.mjs",
  "next-env.d.ts",
  "components.json",
];

export function prepareNextDistDir() {
  const project = process.cwd();
  rmSync(join(project, "tmp"), { recursive: true, force: true });
  rmSync(LOCAL_APP, { recursive: true, force: true });
  mkdirSync(LOCAL_APP, { recursive: true });
  for (const name of COPY_NAMES) {
    const from = join(project, name);
    if (!existsSync(from)) continue;
    cpSync(from, join(LOCAL_APP, name), {
      recursive: true,
      dereference: true,
      filter: (src) => !src.split("/").pop()?.startsWith("._"),
    });
  }
  for (const name of LINK_NAMES) {
    const from = join(project, name);
    if (!existsSync(from)) continue;
    symlinkSync(from, join(LOCAL_APP, name));
  }
}

function firstCompleteJson(raw) {
  const text = raw.toString("utf8");
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    const match = /position (\d+)/.exec(error instanceof Error ? error.message : "");
    if (!match) return null;
    const candidate = text.slice(0, Number(match[1]));
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      return null;
    }
  }
}

async function repairJsonFile(path) {
  let raw;
  try {
    raw = await readFile(path);
  } catch {
    return;
  }
  const fixed = firstCompleteJson(raw);
  if (fixed === null) return;
  await writeFile(path, fixed);
}

export function watchAndRepairNextJson(root = LOCAL_NEXT_DIST) {
  mkdirSync(root, { recursive: true });
  watch(root, { recursive: true }, (_event, filename) => {
    if (!filename || filename.startsWith("._") || !filename.endsWith(".json")) return;
    void repairJsonFile(join(root, filename));
  });
}

if (process.argv[1]?.endsWith("prepare-next-distdir.mjs")) {
  prepareNextDistDir();
}
