#!/usr/bin/env node
/**
 * Run a command inside the pinned Playwright jammy image so VRT and engine
 * smoke match GitHub `ubuntu-latest` (linux/amd64, image fonts).
 *
 * Already inside that image (CI `container:` or PLAYWRIGHT_IN_DOCKER=1):
 * exec the command directly.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLAYWRIGHT_DOCKER_PLATFORM,
  playwrightDockerImage,
} from "./playwright-image.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NM_VOLUME = "hypercolor-web-playwright-nm-amd64";
const NPM_VOLUME = "hypercolor-web-playwright-npm-amd64";
const HOST_NODE_MODULES = path.join(REPO_ROOT, "node_modules");

function readHostNodeModulesLink() {
  try {
    if (lstatSync(HOST_NODE_MODULES).isSymbolicLink()) {
      return readlinkSync(HOST_NODE_MODULES);
    }
  } catch {
    return null;
  }
  return null;
}

function restoreHostNodeModulesLink(target) {
  if (!target) return;
  try {
    const st = lstatSync(HOST_NODE_MODULES);
    if (st.isSymbolicLink()) {
      if (readlinkSync(HOST_NODE_MODULES) === target) return;
      unlinkSync(HOST_NODE_MODULES);
    } else if (st.isDirectory()) {
      // Docker Desktop replaces a host symlink with the volume mount point.
      rmSync(HOST_NODE_MODULES, { recursive: true, force: true });
    } else {
      unlinkSync(HOST_NODE_MODULES);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
      throw error;
    }
  }
  symlinkSync(target, HOST_NODE_MODULES);
}

function alreadyInPinnedContainer() {
  if (process.env.PLAYWRIGHT_IN_DOCKER === "1") return true;
  return existsSync("/.dockerenv") && existsSync("/ms-playwright");
}

function parseCommand(argv) {
  const dash = argv.indexOf("--");
  const command = dash >= 0 ? argv.slice(dash + 1) : argv;
  return command.length > 0 ? command : ["npm", "run", "test:e2e:static:native"];
}

function run(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    stdio: "inherit",
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function lockHash() {
  return createHash("sha256")
    .update(readFileSync(path.join(REPO_ROOT, "package-lock.json")))
    .digest("hex");
}

function bashQuote(args) {
  return args.map((arg) => JSON.stringify(arg)).join(" ");
}

/** Bind-mount a worktree's common .git so `git ls-files` works in Docker. */
function extraGitMounts() {
  const gitPath = path.join(REPO_ROOT, ".git");
  try {
    if (!lstatSync(gitPath).isFile()) return [];
    const text = readFileSync(gitPath, "utf8");
    const match = text.match(/^gitdir:\s*(.+)$/m);
    if (!match) return [];
    const gitdir = match[1].trim();
    const commonRel = readFileSync(path.join(gitdir, "commondir"), "utf8").trim();
    const common = path.resolve(gitdir, commonRel);
    if (!existsSync(common)) return [];
    return [`${common}:${common}`];
  } catch {
    return [];
  }
}

function main() {
  const command = parseCommand(process.argv.slice(2));
  if (alreadyInPinnedContainer()) {
    process.exit(run(command, { env: { ...process.env, PLAYWRIGHT_IN_DOCKER: "1" } }));
  }

  const image = playwrightDockerImage(REPO_ROOT);
  const uid = os.userInfo().uid;
  const gid = os.userInfo().gid;
  const hash = lockHash();
  const inner = `
set -euo pipefail
export PLAYWRIGHT_IN_DOCKER=1
export COPYFILE_DISABLE=1
export CI="\${CI:-1}"
export HOME=/tmp/pw-home
export npm_config_cache=/tmp/npm-cache
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
mkdir -p "\$HOME" "\$npm_config_cache"
git config --global --add safe.directory /work
git config --global --add safe.directory '*'
# ExFAT AppleDouble sidecars break Next's public/ copy inside Linux.
find /work \\( -name '._*' -o -name '.DS_Store' \\) -not -path '/work/.git/*' -delete 2>/dev/null || true
if ! command -v python3 >/dev/null || ! command -v g++ >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 make g++
fi
if [ ! -f node_modules/.hypercolor-web-lock ] || [ "\$(cat node_modules/.hypercolor-web-lock)" != "${hash}" ]; then
  npm ci
  echo ${hash} > node_modules/.hypercolor-web-lock
fi
${bashQuote(command)}
chown -R ${uid}:${gid} e2e/vrt-baselines test-results playwright-report ux-vrt-report out-e2e .e2e-build 2>/dev/null || true
`.trim();

  console.log(`playwright-docker: ${image} platform=${PLAYWRIGHT_DOCKER_PLATFORM}`);
  const hostLink = readHostNodeModulesLink();
  const gitMounts = extraGitMounts();
  const dockerArgs = [
    "docker",
    "run",
    "--rm",
    "--platform",
    PLAYWRIGHT_DOCKER_PLATFORM,
    "--ipc=host",
    "--init",
    "-e",
    "PLAYWRIGHT_IN_DOCKER=1",
    "-e",
    "COPYFILE_DISABLE=1",
    "-e",
    "CI=1",
    "--shm-size=2g",
    "-v",
    `${REPO_ROOT}:/work`,
    "-v",
    `${NM_VOLUME}:/work/node_modules`,
    "-v",
    `${NPM_VOLUME}:/tmp/npm-cache`,
    "-v",
    `hypercolor-web-e2e-build:/work/.e2e-build`,
  ];
  for (const mount of gitMounts) {
    dockerArgs.push("-v", mount);
  }
  dockerArgs.push("-w", "/work", image, "bash", "-lc", inner);
  let status = 1;
  try {
    status = run(dockerArgs);
  } finally {
    restoreHostNodeModulesLink(hostLink);
  }
  process.exit(status);
}

const invokedDirectly = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (invokedDirectly) {
  main();
}