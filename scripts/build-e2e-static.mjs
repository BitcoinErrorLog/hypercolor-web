#!/usr/bin/env node
/**
 * Clean rebuild of the static export with `NEXT_PUBLIC_E2E_HARNESS=1` into
 * `out-e2e/`. Production `out/` is left alone (stashed around the build).
 *
 * Exclusive: a second invocation is refused while the lock is held.
 * Interrupted runs restore production `out/` (SIGINT/SIGTERM/`finally`).
 * A leftover stash from a prior crash is restored or refused — never deleted.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const E2E_STATIC_LOCK_DIR = ".build-e2e-static.lock";
export const E2E_STATIC_STASH_PREFIX = ".out-prod-stash";
const OUT_NAME = "out";
const OUT_E2E_NAME = "out-e2e";
const MARKER = ".e2e-harness";

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isProdOutStashName(name) {
  return name === E2E_STATIC_STASH_PREFIX || name.startsWith(`${E2E_STATIC_STASH_PREFIX}-`);
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function listProdOutStashes(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isProdOutStashName(entry.name))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

/**
 * @param {string} root
 * @returns {{ status: number, error?: string }}
 */
function recoverLeftoverStash(root) {
  const leftovers = listProdOutStashes(root);
  if (leftovers.length === 0) return { status: 0 };
  if (leftovers.length > 1) {
    return {
      status: 1,
      error:
        `build:e2e:static: multiple leftover production stashes (${leftovers.join(", ")}); ` +
        "inspect them and keep one as out/ before rebuilding",
    };
  }
  const leftover = leftovers[0];
  const out = path.join(root, OUT_NAME);
  if (existsSync(out)) {
    return {
      status: 1,
      error:
        `build:e2e:static: leftover stash at ${leftover} while out/ exists; ` +
        "if out/ is complete, delete the stash, otherwise remove out/ and re-run to restore it",
    };
  }
  renameSync(leftover, out);
  return { status: 0 };
}

/**
 * @param {string} root
 * @param {(child: import("node:child_process").ChildProcess) => void} [onSpawn]
 * @returns {Promise<{ status: number }>}
 */
function defaultRunBuild(root, onSpawn) {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "build"], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        NEXT_PUBLIC_E2E_HARNESS: "1",
      },
    });
    onSpawn?.(child);
    child.on("error", () => resolve({ status: 1 }));
    child.on("exit", (code, signal) => {
      resolve({ status: signal ? 1 : code ?? 1 });
    });
  });
}

/**
 * @param {{
 *   root?: string,
 *   runBuild?: (root: string) => { status?: number | null } | Promise<{ status?: number | null }>,
 *   handleSignals?: boolean,
 * }} [options]
 * @returns {Promise<{ status: number, error?: string }>}
 */
export async function runBuildE2eStatic(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const handleSignals = options.handleSignals !== false;
  const out = path.join(root, OUT_NAME);
  const outE2e = path.join(root, OUT_E2E_NAME);
  const lockDir = path.join(root, E2E_STATIC_LOCK_DIR);
  const stash = path.join(
    root,
    `${E2E_STATIC_STASH_PREFIX}-${process.pid}-${randomBytes(8).toString("hex")}`,
  );

  let locked = false;
  let stashed = false;
  let cleaned = false;
  /** @type {import("node:child_process").ChildProcess | null} */
  let buildChild = null;

  const runBuild =
    options.runBuild ??
    ((buildRoot) =>
      defaultRunBuild(buildRoot, (child) => {
        buildChild = child;
      }));

  const restoreProdOut = () => {
    if (!stashed) return;
    if (existsSync(out)) rmSync(out, { recursive: true, force: true });
    if (existsSync(stash)) renameSync(stash, out);
    stashed = false;
  };

  const releaseLock = () => {
    if (!locked) return;
    rmSync(lockDir, { recursive: true, force: true });
    locked = false;
  };

  const stopBuildChild = () => {
    if (!buildChild) return;
    buildChild.kill("SIGTERM");
    buildChild = null;
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    stopBuildChild();
    restoreProdOut();
    releaseLock();
  };

  const onSignal = () => {
    try {
      cleanup();
    } catch {
      // restore best-effort before exit
    }
    process.exit(1);
  };

  if (handleSignals) {
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  }

  try {
    try {
      mkdirSync(lockDir);
      locked = true;
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
      if (code === "EEXIST") {
        return {
          status: 1,
          error:
            `build:e2e:static: another build holds ${E2E_STATIC_LOCK_DIR}; ` +
            "wait for it to finish, or remove that lock directory if it is stale",
        };
      }
      throw err;
    }

    const recovered = recoverLeftoverStash(root);
    if (recovered.status !== 0) return recovered;

    rmSync(outE2e, { recursive: true, force: true });

    if (existsSync(out)) {
      renameSync(out, stash);
      stashed = true;
    }

    const result = await Promise.resolve(runBuild(root));
    if ((result.status ?? 1) !== 0) {
      return { status: result.status ?? 1, error: "build:e2e:static: next build failed" };
    }

    if (!existsSync(out)) {
      return { status: 1, error: "build:e2e:static: next build did not write out/" };
    }

    writeFileSync(path.join(out, MARKER), "NEXT_PUBLIC_E2E_HARNESS=1\n");
    renameSync(out, outE2e);
    restoreProdOut();
    console.log(`build:e2e:static: wrote ${outE2e} with ${MARKER}`);
    return { status: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 1, error: `build:e2e:static: ${message}` };
  } finally {
    if (handleSignals) {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }
    cleanup();
  }
}

async function main() {
  const result = await runBuildE2eStatic();
  if (result.status !== 0) {
    if (result.error) console.error(result.error);
    process.exit(result.status);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  path.normalize(fileURLToPath(import.meta.url)) ===
    path.normalize(path.resolve(process.argv[1]));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
