#!/usr/bin/env node
/**
 * Clean rebuild of the static export with `NEXT_PUBLIC_E2E_HARNESS=1` into
 * `out-e2e/`. The Next build runs in an isolated tree so production `out/`
 * and `.next/` are never touched.
 *
 * Exclusive: a second invocation is refused while the lock is held (serializes
 * `out-e2e` publication only). Interrupted runs never publish: they signal the
 * spawned process group, wait for exit (then SIGKILL), remove the isolated
 * tree, release the lock, and exit with the signal's conventional code.
 *
 * Copy set: git tracked files plus untracked-but-not-ignored files (so the
 * harness export matches `npm run build` from the working tree), plus a small
 * list of gitignored inputs Next needs (`public/sqlite3.wasm`, `next-env.d.ts`).
 * `.env*` files are never copied: `next build` inlines `NEXT_PUBLIC_*` from the
 * child env (`NEXT_PUBLIC_E2E_HARNESS=1` plus any already in `process.env`).
 * This repo's other `NEXT_PUBLIC_*` keys default empty in source, so copying
 * dotenv files would only duplicate secrets onto disk. After the lock is taken,
 * a lone `out-e2e.old-*` is restored to `out-e2e/` when the live path is
 * missing, then leftover `out-e2e.tmp-*`, `out-e2e.old-*`, and this root's
 * `hypercolor-e2e-isol-<roothash>-*` trees are removed. Publish swaps via
 * rename (old tree aside, new tree in, then delete the aside) so `out-e2e/`
 * is never removed before the replacement is in place; a thrown failure of
 * the second rename restores the previous tree.
 *
 * `E2E_STATIC_KILL_TIMEOUT_MS` bounds how long SIGTERM is waited before
 * SIGKILL (default 10000). A second SIGINT/SIGTERM during that window
 * escalates immediately to SIGKILL.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const E2E_STATIC_LOCK_DIR = ".build-e2e-static.lock";
export const E2E_BUILD_DIR = ".e2e-build";
const OUT_NAME = "out";
const OUT_E2E_NAME = "out-e2e";
const MARKER = ".e2e-harness";
const DEFAULT_CHILD_STOP_MS = 10_000;
const EXPLICIT_EXTRAS = ["public/sqlite3.wasm", "next-env.d.ts"];

/**
 * Isolated-tree prefix scoped to this checkout so a tmpdir sweep cannot
 * delete another root's in-flight copy.
 * @param {string} root
 * @returns {string}
 */
export function isolPrefixForRoot(root) {
  const hash = createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 12);
  return `hypercolor-e2e-isol-${hash}-`;
}

/**
 * @param {string} rel
 * @returns {boolean}
 */
function isDotEnvFile(rel) {
  const base = path.posix.basename(rel.replace(/\\/g, "/"));
  return base === ".env" || base.startsWith(".env.");
}

/**
 * @param {string} rel
 * @returns {boolean}
 */
function shouldExcludeFromE2eCopy(rel) {
  const top = rel.replace(/\\/g, "/").split("/")[0];
  if (
    top === "node_modules" ||
    top === ".next" ||
    top === ".git" ||
    top === E2E_BUILD_DIR ||
    top === E2E_STATIC_LOCK_DIR
  ) {
    return true;
  }
  if (top === OUT_NAME || top === OUT_E2E_NAME || top.startsWith(`${OUT_E2E_NAME}.`)) {
    return true;
  }
  if (rel.replace(/\\/g, "/").startsWith("app/api/")) return true;
  if (isDotEnvFile(rel)) return true;
  return false;
}

/**
 * @param {NodeJS.Signals} signal
 * @returns {number}
 */
function signalExitCode(signal) {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 1;
}

/**
 * @returns {number}
 */
function childStopMsFromEnv() {
  const raw = process.env.E2E_STATIC_KILL_TIMEOUT_MS;
  if (raw == null || raw === "") return DEFAULT_CHILD_STOP_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CHILD_STOP_MS;
  return Math.trunc(n);
}

/**
 * Working-tree paths: tracked files plus untracked files that are not ignored.
 * @param {string} root
 * @returns {string[]}
 */
function gitWorkingTreeFiles(root) {
  const raw = execFileSync(
    "git",
    ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return raw.toString("utf8").split("\0").filter(Boolean);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameFilesystem(a, b) {
  try {
    return statSync(a).dev === statSync(b).dev;
  } catch {
    return false;
  }
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function pickIsolatedBase(projectRoot) {
  const osTmp = tmpdir();
  if (sameFilesystem(osTmp, projectRoot)) return osTmp;
  const local = path.join(projectRoot, E2E_BUILD_DIR);
  mkdirSync(local, { recursive: true });
  return local;
}

/**
 * @param {string} dir
 * @param {string} prefix
 */
function removePrefixedEntries(dir, prefix) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue;
    rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

/**
 * Unlink every `.env*` under `dir` (no overwrite — that is a no-op on modern FS).
 * @param {string} dir
 */
function unlinkEnvFiles(dir) {
  if (!dir || !existsSync(dir)) return;
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of names) {
    if (ent.name.startsWith("._")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      unlinkEnvFiles(full);
      continue;
    }
    if (ent.name === ".env" || ent.name.startsWith(".env.")) {
      rmSync(full, { force: true });
    }
  }
}

/**
 * If a previous run died after moving live `out-e2e` aside, put that tree back
 * before sweeping so a failed next run does not leave the project with no export.
 * @param {string} root
 */
function recoverOrphanedPublish(root) {
  const live = path.join(root, OUT_E2E_NAME);
  if (existsSync(live) || !existsSync(root)) return;
  const olds = readdirSync(root).filter((name) => name.startsWith(`${OUT_E2E_NAME}.old-`));
  if (olds.length === 0) return;
  // Newest mtime wins when multiple crashed publishes remain; drop the rest
  // so a later sweep cannot leave the project with no export.
  olds.sort((a, b) => {
    const am = statSync(path.join(root, a)).mtimeMs;
    const bm = statSync(path.join(root, b)).mtimeMs;
    if (bm !== am) return bm - am;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const winner = olds[0];
  for (const name of olds.slice(1)) {
    rmSync(path.join(root, name), { recursive: true, force: true });
  }
  renameSync(path.join(root, winner), live);
}

/**
 * Leftovers from a SIGKILLed previous run: staging trees and isolated copies.
 * Safe only while the lock is held. Isolated tmpdir names are per-root.
 * @param {string} root
 */
function sweepStaleArtifacts(root) {
  recoverOrphanedPublish(root);
  if (existsSync(root)) {
    for (const name of readdirSync(root)) {
      if (name.startsWith(`${OUT_E2E_NAME}.tmp-`) || name.startsWith(`${OUT_E2E_NAME}.old-`)) {
        rmSync(path.join(root, name), { recursive: true, force: true });
      }
    }
  }
  const prefix = isolPrefixForRoot(root);
  removePrefixedEntries(path.join(root, E2E_BUILD_DIR), prefix);
  removePrefixedEntries(tmpdir(), prefix);
}

/**
 * @param {string} srcRoot
 * @param {string} destRoot
 */
function copyProjectSources(srcRoot, destRoot) {
  const files = new Set(gitWorkingTreeFiles(srcRoot));
  for (const extra of EXPLICIT_EXTRAS) {
    if (existsSync(path.join(srcRoot, extra))) files.add(extra);
  }
  for (const rel of files) {
    if (shouldExcludeFromE2eCopy(rel)) continue;
    const from = path.join(srcRoot, rel);
    const to = path.join(destRoot, rel);
    if (!existsSync(from)) continue;
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  const nmSrc = path.resolve(srcRoot, "node_modules");
  const nmDest = path.join(destRoot, "node_modules");
  if (existsSync(nmSrc) && !existsSync(nmDest)) {
    symlinkSync(nmSrc, nmDest, "dir");
  }
}

/**
 * @param {string} tmpPublish
 * @param {string} outE2e
 * @param {string} oldPublish
 */
function swapPublish(tmpPublish, outE2e, oldPublish) {
  if (existsSync(oldPublish)) {
    rmSync(oldPublish, { recursive: true, force: true });
  }
  let movedAside = false;
  try {
    if (existsSync(outE2e)) {
      renameSync(outE2e, oldPublish);
      movedAside = true;
    }
    renameSync(tmpPublish, outE2e);
  } catch (err) {
    if (movedAside && existsSync(oldPublish) && !existsSync(outE2e)) {
      try {
        renameSync(oldPublish, outE2e);
      } catch {
        // keep the original error
      }
    }
    throw err;
  }
  if (existsSync(oldPublish)) {
    rmSync(oldPublish, { recursive: true, force: true });
  }
}

/**
 * @param {number} pid
 * @param {NodeJS.Signals} signal
 */
function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {number} timeoutMs
 * @returns {Promise<"exited" | "timeout">}
 */
function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve("exited");
      return;
    }
    let settled = false;
    const done = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(reason);
    };
    const onExit = () => done("exited");
    const timer = setTimeout(() => done("timeout"), timeoutMs);
    child.once("exit", onExit);
  });
}

/**
 * @param {string} buildRoot
 * @param {(child: import("node:child_process").ChildProcess) => void} [onSpawn]
 * @returns {Promise<{ status: number }>}
 */
function defaultRunBuild(buildRoot, onSpawn) {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "build"], {
      cwd: buildRoot,
      stdio: "inherit",
      detached: true,
      env: {
        ...process.env,
        NEXT_PUBLIC_E2E_HARNESS: "1",
        HC_STATIC_EXPORT: "1",
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
  const childStopMs = childStopMsFromEnv();
  const outE2e = path.join(root, OUT_E2E_NAME);
  const lockDir = path.join(root, E2E_STATIC_LOCK_DIR);
  const tmpPublish = path.join(root, `${OUT_E2E_NAME}.tmp-${process.pid}`);
  const oldPublish = path.join(root, `${OUT_E2E_NAME}.old-${process.pid}`);

  let locked = false;
  let cleaned = false;
  let aborting = false;
  let childExited = false;
  /** @type {Promise<void> | null} */
  let abortPromise = null;
  /** @type {string | null} */
  let isolatedRoot = null;
  /** @type {import("node:child_process").ChildProcess | null} */
  let buildChild = null;

  const markChildExited = (child) => {
    childExited = true;
    if (buildChild === child) buildChild = null;
  };

  const runBuild =
    options.runBuild ??
    ((buildRoot) =>
      defaultRunBuild(buildRoot, (child) => {
        buildChild = child;
        if (child.exitCode !== null || child.signalCode !== null) {
          markChildExited(child);
          return;
        }
        child.once("exit", () => markChildExited(child));
      }));

  const releaseLock = () => {
    if (!locked) return;
    rmSync(lockDir, { recursive: true, force: true });
    locked = false;
  };

  const removeIsolatedRoot = () => {
    if (isolatedRoot && existsSync(isolatedRoot)) {
      unlinkEnvFiles(isolatedRoot);
      rmSync(isolatedRoot, { recursive: true, force: true });
    }
    isolatedRoot = null;
    const localBase = path.join(root, E2E_BUILD_DIR);
    if (existsSync(localBase)) {
      const names = readdirSync(localBase).filter((name) => !name.startsWith("._"));
      if (names.length === 0) {
        rmSync(localBase, { recursive: true, force: true });
      }
    }
  };

  const stopBuildChild = async () => {
    const child = buildChild;
    if (!child?.pid || childExited || child.exitCode !== null || child.signalCode !== null) {
      buildChild = null;
      return;
    }
    const pid = child.pid;
    signalProcessGroup(pid, "SIGTERM");
    const waited = await waitForChildExit(child, childStopMs);
    if (waited === "timeout") {
      if (!childExited && child.exitCode === null && child.signalCode === null) {
        signalProcessGroup(pid, "SIGKILL");
        await waitForChildExit(child, childStopMs);
      }
    }
    buildChild = null;
  };

  const escalateKill = () => {
    const child = buildChild;
    if (!child?.pid || childExited || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    signalProcessGroup(child.pid, "SIGKILL");
  };

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await stopBuildChild();
    if (existsSync(tmpPublish)) {
      unlinkEnvFiles(tmpPublish);
      rmSync(tmpPublish, { recursive: true, force: true });
    }
    if (existsSync(oldPublish)) {
      unlinkEnvFiles(oldPublish);
      rmSync(oldPublish, { recursive: true, force: true });
    }
    removeIsolatedRoot();
    releaseLock();
  };

  /** @param {NodeJS.Signals} signal */
  const onSignal = (signal) => {
    if (aborting) {
      escalateKill();
      return;
    }
    aborting = true;
    abortPromise = cleanup().finally(() => {
      process.exit(signalExitCode(signal));
    });
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

    sweepStaleArtifacts(root);

    if (aborting) return { status: 1, error: "build:e2e:static: interrupted" };

    isolatedRoot = mkdtempSync(path.join(pickIsolatedBase(root), `${isolPrefixForRoot(root)}${process.pid}-`));
    copyProjectSources(root, isolatedRoot);

    const result = await Promise.resolve(runBuild(isolatedRoot));
    if (aborting) {
      return { status: 1, error: "build:e2e:static: interrupted" };
    }
    if ((result.status ?? 1) !== 0) {
      return { status: result.status ?? 1, error: "build:e2e:static: next build failed" };
    }

    const isolatedOut = path.join(isolatedRoot, OUT_NAME);
    if (!existsSync(isolatedOut)) {
      return { status: 1, error: "build:e2e:static: next build did not write out/" };
    }
    if (!existsSync(path.join(isolatedOut, MARKER))) {
      return {
        status: 1,
        error: "build:e2e:static: isolated export is missing out/.e2e-harness",
      };
    }

    if (aborting) {
      return { status: 1, error: "build:e2e:static: interrupted" };
    }

    if (existsSync(tmpPublish)) {
      rmSync(tmpPublish, { recursive: true, force: true });
    }
    try {
      renameSync(isolatedOut, tmpPublish);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
      if (code === "EXDEV") {
        return {
          status: 1,
          error:
            "build:e2e:static: isolated out/ is on a different filesystem from the project; " +
            `use ${E2E_BUILD_DIR}/ so the publish rename is atomic`,
        };
      }
      throw err;
    }
    swapPublish(tmpPublish, outE2e, oldPublish);
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
    if (aborting && abortPromise) {
      await abortPromise;
    } else {
      await cleanup();
    }
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
