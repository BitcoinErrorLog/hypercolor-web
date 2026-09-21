import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  E2E_BUILD_DIR,
  E2E_STATIC_LOCK_DIR,
  isolPrefixForRoot,
  runBuildE2eStatic,
  shouldExcludeFromE2eCopy,
} from "./build-e2e-static.mjs";

const SCRIPT = fileURLToPath(new URL("./build-e2e-static.mjs", import.meta.url));
const temps = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "hc-e2e-static-"));
  temps.push(dir);
  return dir;
}

function initTrackedRepo(root, files = { "README.md": "tracked\n" }) {
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  execFileSync("git", ["add", "-A"], { cwd: root });
}

function writeProdOut(root, body = "prod") {
  const out = path.join(root, "out");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "index.html"), body);
}

function writeNextMarker(root, body = "next-prod") {
  const dir = path.join(root, ".next");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "marker"), body);
}

function readOut(root) {
  const file = path.join(root, "out", "index.html");
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function fingerprint(file) {
  const buf = readFileSync(file);
  return {
    hash: createHash("sha256").update(buf).digest("hex"),
    mtimeMs: statSync(file).mtimeMs,
    size: buf.length,
  };
}

function leftoverIsolDirs(pid, root) {
  const prefix = `${isolPrefixForRoot(root)}${pid}-`;
  const bases = [tmpdir(), path.join(root, E2E_BUILD_DIR)];
  const found = [];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      if (name.startsWith(prefix)) found.push(path.join(base, name));
    }
  }
  return found;
}

function envFilesUnder(dir) {
  const found = [];
  if (!existsSync(dir)) return found;
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      if (name.startsWith("._")) continue;
      const full = path.join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name === ".env" || name.startsWith(".env.")) found.push(full);
    }
  };
  walk(dir);
  return found;
}

function tmpPublishDirs(root) {
  return readdirSync(root).filter((name) => name.startsWith("out-e2e.tmp-"));
}

function oldPublishDirs(root) {
  return readdirSync(root).filter((name) => name.startsWith("out-e2e.old-"));
}

function killPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

function spawnScript(root, extraEnv = {}) {
  const childScript = path.join(root, "hang-build.mjs");
  writeFileSync(
    childScript,
    `
import { runBuildE2eStatic } from ${JSON.stringify(SCRIPT)};
const root = ${JSON.stringify(root)};
const result = await runBuildE2eStatic({ root });
if (result.status !== 0 && result.error) {
  console.error(result.error);
}
process.exit(result.status);
`,
  );
  const bin = path.join(root, "bin");
  return spawn(process.execPath, [childScript], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...extraEnv },
  });
}

function waitForFile(file, timeoutMs = 8_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (existsSync(file)) {
        resolve(undefined);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`timed out waiting for ${file}`));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

function waitForOutput(stream, needle, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes(needle)) {
        cleanup();
        resolve(undefined);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${needle}; got: ${buf}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
    };
    stream.on("data", onData);
  });
}

function successfulHarnessBuild(buildRoot) {
  mkdirSync(path.join(buildRoot, "out"), { recursive: true });
  writeFileSync(path.join(buildRoot, "out", "index.html"), "harness");
  writeFileSync(path.join(buildRoot, "out", ".e2e-harness"), "1\n");
  return { status: 0 };
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("shouldExcludeFromE2eCopy", () => {
  it("drops app/api routes and unit tests so static export typecheck cannot import them", () => {
    expect(shouldExcludeFromE2eCopy("app/api/gif/fetch/route.ts")).toBe(true);
    expect(shouldExcludeFromE2eCopy("src/server/gif-proxy.test.ts")).toBe(true);
    expect(shouldExcludeFromE2eCopy("src/components/thread-view.test.tsx")).toBe(true);
    expect(shouldExcludeFromE2eCopy("e2e/production-hooks.spec.ts")).toBe(true);
    expect(shouldExcludeFromE2eCopy("public/._sqlite3.wasm")).toBe(true);
    expect(shouldExcludeFromE2eCopy("src/server/gif-proxy.ts")).toBe(false);
    expect(shouldExcludeFromE2eCopy("src/components/thread-view.tsx")).toBe(false);
  });

  it("strips AppleDouble sidecars from isolated public/ before the Next build", async () => {
    const root = tempDir();
    initTrackedRepo(root, {
      "README.md": "tracked\n",
      "public/sqlite3.wasm": "wasm\n",
    });
    writeFileSync(path.join(root, "public", "._sqlite3.wasm"), "sidecar\n");
    writeProdOut(root, "prod");
    const result = await runBuildE2eStatic({
      root,
      handleSignals: false,
      runBuild: (buildRoot) => {
        expect(existsSync(path.join(buildRoot, "public", "sqlite3.wasm"))).toBe(true);
        expect(existsSync(path.join(buildRoot, "public", "._sqlite3.wasm"))).toBe(false);
        mkdirSync(path.join(buildRoot, "out"), { recursive: true });
        writeFileSync(path.join(buildRoot, "out", "index.html"), "harness");
        writeFileSync(path.join(buildRoot, "out", ".e2e-harness"), "1\n");
        return { status: 0 };
      },
    });
    expect(result.status).toBe(0);
  });
});

describe("build-e2e-static isolation", () => {
  it("does not change out-e2e when the child fails and removes the isolated root", async () => {
    const root = tempDir();
    initTrackedRepo(root);
    writeProdOut(root, "prod");
    mkdirSync(path.join(root, "out-e2e"));
    writeFileSync(path.join(root, "out-e2e", "index.html"), "keep");
    const result = await runBuildE2eStatic({
      root,
      handleSignals: false,
      runBuild: (buildRoot) => {
        mkdirSync(path.join(buildRoot, "out"), { recursive: true });
        writeFileSync(path.join(buildRoot, "out", "index.html"), "harness");
        writeFileSync(path.join(buildRoot, "out", ".e2e-harness"), "1\n");
        return { status: 1 };
      },
    });
    expect(result.status).toBe(1);
    expect(readOut(root)).toBe("prod");
    expect(readFileSync(path.join(root, "out-e2e", "index.html"), "utf8")).toBe("keep");
    expect(existsSync(path.join(root, E2E_STATIC_LOCK_DIR))).toBe(false);
    expect(existsSync(path.join(root, E2E_BUILD_DIR))).toBe(false);
    expect(tmpPublishDirs(root)).toEqual([]);
    expect(oldPublishDirs(root)).toEqual([]);
    expect(leftoverIsolDirs(process.pid, root)).toEqual([]);
  });

  it(
    "awaits a stubborn spawned child before releasing the lock and never publishes on interrupt",
    async () => {
      const root = tempDir();
      initTrackedRepo(root);
      writeProdOut(root, "prod");
      writeNextMarker(root);
      const bin = path.join(root, "bin");
      mkdirSync(bin);
      writeFileSync(
        path.join(bin, "npm"),
        `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
process.on("SIGTERM", () => {});
process.on("SIGINT", () => {});
console.log("BUILD_STARTED");
setTimeout(() => {
  writeFileSync(join(process.cwd(), "late-write.txt"), "late");
  mkdirSync(join(process.cwd(), "out"), { recursive: true });
  writeFileSync(join(process.cwd(), "out", "late-write.txt"), "late");
  process.exit(0);
}, 2000);
setInterval(() => {}, 1000);
`,
      );
      chmodSync(path.join(bin, "npm"), 0o755);
      const childScript = path.join(root, "hang-build.mjs");
      writeFileSync(
        childScript,
        `
import { runBuildE2eStatic } from ${JSON.stringify(SCRIPT)};
const root = ${JSON.stringify(root)};
const result = await runBuildE2eStatic({ root });
if (result.status !== 0 && result.error) {
  console.error(result.error);
}
process.exit(result.status);
`,
      );
      const child = spawn(process.execPath, [childScript], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      child.stderr.resume();
      const exited = new Promise((resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      try {
        await waitForOutput(child.stdout, "BUILD_STARTED");
        await waitForFile(path.join(root, E2E_STATIC_LOCK_DIR));
        const interruptedAt = Date.now();
        child.kill("SIGINT");
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(existsSync(path.join(root, E2E_STATIC_LOCK_DIR))).toBe(true);
        const status = await exited;
        expect(
          status.signal === "SIGINT" ||
            status.code === 130 ||
            (status.code !== 0 && status.code !== null),
        ).toBe(true);
        expect(Date.now() - interruptedAt).toBeGreaterThan(1500);
        expect(existsSync(path.join(root, E2E_STATIC_LOCK_DIR))).toBe(false);
        expect(existsSync(path.join(root, "late-write.txt"))).toBe(false);
        expect(existsSync(path.join(root, "out", "late-write.txt"))).toBe(false);
        expect(readOut(root)).toBe("prod");
        expect(existsSync(path.join(root, "out-e2e"))).toBe(false);
        expect(tmpPublishDirs(root)).toEqual([]);
        expect(oldPublishDirs(root)).toEqual([]);
        expect(leftoverIsolDirs(child.pid, root)).toEqual([]);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
    },
    20_000,
  );

  it("refuses a second concurrent invocation while the lock is held", async () => {
    const root = tempDir();
    writeProdOut(root, "prod");
    mkdirSync(path.join(root, E2E_STATIC_LOCK_DIR));
    const result = await runBuildE2eStatic({
      root,
      handleSignals: false,
      runBuild: () => {
        throw new Error("must not share .next/ or out/");
      },
    });
    expect(result.status).toBe(1);
    expect(result.error).toMatch(/another build holds/);
    expect(readOut(root)).toBe("prod");
    expect(existsSync(path.join(root, "out-e2e"))).toBe(false);
  });

  it("leaves production out/ and .next/ byte-identical after a harness build", async () => {
    const root = tempDir();
    initTrackedRepo(root);
    writeProdOut(root, "prod");
    writeNextMarker(root, "next-prod");
    const outBefore = fingerprint(path.join(root, "out", "index.html"));
    const nextBefore = fingerprint(path.join(root, ".next", "marker"));
    const result = await runBuildE2eStatic({
      root,
      handleSignals: false,
      runBuild: successfulHarnessBuild,
    });
    expect(result.status).toBe(0);
    expect(fingerprint(path.join(root, "out", "index.html"))).toEqual(outBefore);
    expect(fingerprint(path.join(root, ".next", "marker"))).toEqual(nextBefore);
    expect(readFileSync(path.join(root, "out-e2e", "index.html"), "utf8")).toBe("harness");
    expect(existsSync(path.join(root, "out-e2e", ".e2e-harness"))).toBe(true);
    expect(existsSync(path.join(root, E2E_STATIC_LOCK_DIR))).toBe(false);
    expect(leftoverIsolDirs(process.pid, root)).toEqual([]);
  });

  it("replaces an existing out-e2e tree without merging leftover files", async () => {
    const root = tempDir();
    initTrackedRepo(root);
    mkdirSync(path.join(root, "out-e2e"));
    writeFileSync(path.join(root, "out-e2e", "index.html"), "old-index");
    writeFileSync(path.join(root, "out-e2e", "stale.html"), "old");
    const result = await runBuildE2eStatic({
      root,
      handleSignals: false,
      runBuild: successfulHarnessBuild,
    });
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(root, "out-e2e", "index.html"), "utf8")).toBe("harness");
    expect(existsSync(path.join(root, "out-e2e", "stale.html"))).toBe(false);
    expect(existsSync(path.join(root, "out-e2e", ".e2e-harness"))).toBe(true);
    expect(tmpPublishDirs(root)).toEqual([]);
    expect(oldPublishDirs(root)).toEqual([]);
    expect(existsSync(path.join(root, E2E_STATIC_LOCK_DIR))).toBe(false);
  });

  it("does not publish when the isolated export is missing the harness marker", async () => {
    const root = tempDir();
    initTrackedRepo(root);
    mkdirSync(path.join(root, "out-e2e"));
    writeFileSync(path.join(root, "out-e2e", "index.html"), "keep");
    const result = await runBuildE2eStatic({
      root,
      handleSignals: false,
      runBuild: (buildRoot) => {
        mkdirSync(path.join(buildRoot, "out"), { recursive: true });
        writeFileSync(path.join(buildRoot, "out", "index.html"), "harness");
        return { status: 0 };
      },
    });
    expect(result.status).toBe(1);
    expect(result.error).toMatch(/missing out\/\.e2e-harness/);
    expect(readFileSync(path.join(root, "out-e2e", "index.html"), "utf8")).toBe("keep");
    expect(existsSync(path.join(root, E2E_STATIC_LOCK_DIR))).toBe(false);
  });

  it("does not SIGTERM a successful child's process group after it has exited", async () => {
    const root = tempDir();
    initTrackedRepo(root);
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    const canaryHit = path.join(root, "canary-sigterm");
    const canaryReady = path.join(root, "canary-ready");
    const canaryPidFile = path.join(root, "canary.pid");
    writeFileSync(
      path.join(bin, "npm"),
      `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
spawn(process.execPath, ["-e", ${JSON.stringify(`
  const { writeFileSync } = require("node:fs");
  writeFileSync(process.env.CANARY_PID, String(process.pid));
  process.on("SIGHUP", () => {});
  process.on("SIGTERM", () => { writeFileSync(process.env.CANARY_HIT, "SIGTERM"); });
  process.on("SIGINT", () => {});
  writeFileSync(process.env.CANARY_READY, "1");
  setInterval(() => {}, 1000);
`)}], { stdio: "ignore", detached: false, env: process.env });
const started = Date.now();
while (Date.now() - started < 4000) {
  if (existsSync(process.env.CANARY_READY)) break;
}
mkdirSync(join(process.cwd(), "out"), { recursive: true });
writeFileSync(join(process.cwd(), "out", "index.html"), "harness");
writeFileSync(join(process.cwd(), "out", ".e2e-harness"), "1\\n");
process.exit(0);
`,
    );
    chmodSync(path.join(bin, "npm"), 0o755);
    const prevPath = process.env.PATH;
    process.env.PATH = `${bin}:${prevPath}`;
    process.env.CANARY_HIT = canaryHit;
    process.env.CANARY_READY = canaryReady;
    process.env.CANARY_PID = canaryPidFile;
    let canaryPid = 0;
    try {
      const result = await runBuildE2eStatic({ root, handleSignals: false });
      expect(result.status).toBe(0);
      expect(existsSync(canaryPidFile)).toBe(true);
      canaryPid = Number(readFileSync(canaryPidFile, "utf8").trim());
      expect(canaryPid).toBeGreaterThan(0);
      expect(() => process.kill(canaryPid, 0)).not.toThrow();
      expect(existsSync(canaryHit)).toBe(false);
      expect(readFileSync(path.join(root, "out-e2e", "index.html"), "utf8")).toBe("harness");
    } finally {
      process.env.PATH = prevPath;
      delete process.env.CANARY_HIT;
      delete process.env.CANARY_READY;
      delete process.env.CANARY_PID;
      if (canaryPid) killPid(canaryPid);
      else if (existsSync(canaryPidFile)) {
        killPid(Number(readFileSync(canaryPidFile, "utf8").trim()));
      }
    }
  }, 15_000);

  it("sweeps stale tmp publish dirs and isolated leftovers after taking the lock", async () => {
    const root = tempDir();
    initTrackedRepo(root);
    const staleTmp = path.join(root, "out-e2e.tmp-99999");
    mkdirSync(staleTmp);
    writeFileSync(path.join(staleTmp, ".env"), "SECRET=tmp\n");
    const staleOld = path.join(root, "out-e2e.old-99999");
    mkdirSync(staleOld);
    writeFileSync(path.join(staleOld, "index.html"), "old-secret");
    const staleIsol = path.join(root, E2E_BUILD_DIR, `${isolPrefixForRoot(root)}99999-STALE`);
    mkdirSync(staleIsol, { recursive: true });
    writeFileSync(path.join(staleIsol, ".env.local"), "SECRET=isol\n");
    const staleTmpdir = path.join(tmpdir(), `${isolPrefixForRoot(root)}99999-STALE`);
    mkdirSync(staleTmpdir, { recursive: true });
    writeFileSync(path.join(staleTmpdir, ".env"), "SECRET=tmpisol\n");
    temps.push(staleTmpdir);
    const result = await runBuildE2eStatic({
      root,
      handleSignals: false,
      runBuild: successfulHarnessBuild,
    });
    expect(result.status).toBe(0);
    expect(existsSync(staleTmp)).toBe(false);
    expect(existsSync(staleOld)).toBe(false);
    expect(existsSync(staleIsol)).toBe(false);
    expect(existsSync(staleTmpdir)).toBe(false);
    expect(tmpPublishDirs(root)).toEqual([]);
    expect(oldPublishDirs(root)).toEqual([]);
    expect(leftoverIsolDirs(process.pid, root)).toEqual([]);
  });

  it("does not drop the previous export before the replacement is renamed in", async () => {
    const root = tempDir();
    initTrackedRepo(root);
    const live = path.join(root, "out-e2e");
    mkdirSync(live);
    writeFileSync(path.join(live, "index.html"), "old-index");
    for (let i = 0; i < 400; i += 1) {
      writeFileSync(path.join(live, `pad-${i}.txt`), `pad-${i}\n`);
    }
    const indexFile = path.join(live, "index.html");
    const missingFile = path.join(root, "index-went-missing");
    const stopFile = path.join(root, "stop-poller");
    const readyFile = path.join(root, "poller-ready");
    const poller = spawn(
      process.execPath,
      [
        "-e",
        `
const { existsSync, readdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const root = ${JSON.stringify(root)};
const indexFile = ${JSON.stringify(indexFile)};
const missingFile = ${JSON.stringify(missingFile)};
const stopFile = ${JSON.stringify(stopFile)};
const readyFile = ${JSON.stringify(readyFile)};
function exportVisible() {
  if (existsSync(indexFile)) return true;
  if (!existsSync(root)) return false;
  for (const name of readdirSync(root)) {
    if (name.startsWith("out-e2e.old-") && existsSync(join(root, name, "index.html"))) {
      return true;
    }
  }
  return false;
}
writeFileSync(readyFile, "1");
let missingSamples = 0;
while (!existsSync(stopFile)) {
  if (!exportVisible()) {
    missingSamples += 1;
    if (missingSamples >= 5) {
      writeFileSync(missingFile, "missing");
      break;
    }
  } else {
    missingSamples = 0;
  }
}
`,
      ],
      { stdio: "ignore" },
    );
    const pollerExited = new Promise((resolve) => {
      poller.once("exit", () => resolve(undefined));
    });
    try {
      await waitForFile(readyFile);
      const result = await runBuildE2eStatic({
        root,
        handleSignals: false,
        runBuild: successfulHarnessBuild,
      });
      expect(result.status).toBe(0);
      expect(readFileSync(indexFile, "utf8")).toBe("harness");
      expect(existsSync(path.join(live, "pad-0.txt"))).toBe(false);
      expect(existsSync(missingFile)).toBe(false);
      expect(oldPublishDirs(root)).toEqual([]);
      expect(tmpPublishDirs(root)).toEqual([]);
    } finally {
      writeFileSync(stopFile, "1");
      await Promise.race([
        pollerExited,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      if (poller.exitCode === null && poller.signalCode === null) {
        poller.kill("SIGKILL");
      }
    }
  });

  it("copies untracked source files into the isolated tree", async () => {
    const root = tempDir();
    initTrackedRepo(root, {
      ".gitignore": "node_modules\n.next\n/out/\n/out-e2e/\n.env*\n",
      "src/tracked.tsx": "export const tracked = 1;\n",
    });
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(
      path.join(root, "src", "untracked-widget.tsx"),
      "export const UntrackedWidget = () => null;\n",
    );
    writeFileSync(path.join(root, ".env.development"), "NOPE=1\n");
    mkdirSync(path.join(root, "outbox"));
    writeFileSync(path.join(root, "outbox", "note.txt"), "keep-me\n");
    let sawUntracked = false;
    let sawTracked = false;
    let sawEnvDev = false;
    let sawOutbox = false;
    const result = await runBuildE2eStatic({
      root,
      handleSignals: false,
      runBuild: (buildRoot) => {
        sawUntracked = existsSync(path.join(buildRoot, "src", "untracked-widget.tsx"));
        sawTracked = existsSync(path.join(buildRoot, "src", "tracked.tsx"));
        sawEnvDev = existsSync(path.join(buildRoot, ".env.development"));
        sawOutbox = existsSync(path.join(buildRoot, "outbox", "note.txt"));
        return successfulHarnessBuild(buildRoot);
      },
    });
    expect(result.status).toBe(0);
    expect(sawUntracked).toBe(true);
    expect(sawTracked).toBe(true);
    expect(sawEnvDev).toBe(false);
    expect(sawOutbox).toBe(true);
    expect(envFilesUnder(path.join(root, "out-e2e"))).toEqual([]);
    expect(leftoverIsolDirs(process.pid, root)).toEqual([]);
  });

  it(
    "SIGKILLs a child that ignores SIGTERM, then releases the lock without publishing",
    async () => {
      const root = tempDir();
      initTrackedRepo(root);
      writeProdOut(root, "prod");
      const bin = path.join(root, "bin");
      mkdirSync(bin);
      writeFileSync(
        path.join(bin, "npm"),
        `#!/usr/bin/env node
process.on("SIGTERM", () => {});
process.on("SIGINT", () => {});
console.log("BUILD_STARTED");
setInterval(() => {}, 1000);
`,
      );
      chmodSync(path.join(bin, "npm"), 0o755);
      const child = spawnScript(root, { E2E_STATIC_KILL_TIMEOUT_MS: "250" });
      child.stderr.resume();
      const exited = new Promise((resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      try {
        await waitForOutput(child.stdout, "BUILD_STARTED");
        await waitForFile(path.join(root, E2E_STATIC_LOCK_DIR));
        const interruptedAt = Date.now();
        child.kill("SIGTERM");
        const status = await exited;
        expect(status.code).toBe(143);
        expect(Date.now() - interruptedAt).toBeGreaterThan(150);
        expect(Date.now() - interruptedAt).toBeLessThan(8000);
        expect(existsSync(path.join(root, E2E_STATIC_LOCK_DIR))).toBe(false);
        expect(existsSync(path.join(root, "out-e2e"))).toBe(false);
        expect(readOut(root)).toBe("prod");
        expect(tmpPublishDirs(root)).toEqual([]);
        expect(oldPublishDirs(root)).toEqual([]);
        expect(leftoverIsolDirs(child.pid, root)).toEqual([]);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
    },
    20_000,
  );

  it(
    "escalates a second interrupt straight to SIGKILL",
    async () => {
      const root = tempDir();
      initTrackedRepo(root);
      writeProdOut(root, "prod");
      const bin = path.join(root, "bin");
      mkdirSync(bin);
      writeFileSync(
        path.join(bin, "npm"),
        `#!/usr/bin/env node
process.on("SIGTERM", () => {});
process.on("SIGINT", () => {});
console.log("BUILD_STARTED");
setInterval(() => {}, 1000);
`,
      );
      chmodSync(path.join(bin, "npm"), 0o755);
      const child = spawnScript(root, { E2E_STATIC_KILL_TIMEOUT_MS: "4000" });
      child.stderr.resume();
      const exited = new Promise((resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      try {
        await waitForOutput(child.stdout, "BUILD_STARTED");
        await waitForFile(path.join(root, E2E_STATIC_LOCK_DIR));
        const interruptedAt = Date.now();
        child.kill("SIGINT");
        await new Promise((resolve) => setTimeout(resolve, 80));
        child.kill("SIGINT");
        const status = await exited;
        expect(
          status.signal === "SIGINT" ||
            status.code === 130 ||
            (status.code !== 0 && status.code !== null),
        ).toBe(true);
        expect(Date.now() - interruptedAt).toBeLessThan(2500);
        expect(existsSync(path.join(root, E2E_STATIC_LOCK_DIR))).toBe(false);
        expect(existsSync(path.join(root, "out-e2e"))).toBe(false);
        expect(readOut(root)).toBe("prod");
        expect(tmpPublishDirs(root)).toEqual([]);
        expect(leftoverIsolDirs(child.pid, root)).toEqual([]);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
    },
    20_000,
  );

  it("does not copy any .env* into the isolated tree and leaves none under out-e2e", async () => {
    const root = tempDir();
    initTrackedRepo(root);
    writeFileSync(path.join(root, ".env"), "SECRET=root\n");
    writeFileSync(path.join(root, ".env.local"), "SECRET=local\n");
    writeFileSync(path.join(root, ".env.production"), "SECRET=prod\n");
    writeFileSync(path.join(root, ".env.production.local"), "SECRET=prodlocal\n");
    let isolHadEnv = false;
    let isolPath = "";
    const result = await runBuildE2eStatic({
      root,
      handleSignals: false,
      runBuild: (buildRoot) => {
        isolPath = buildRoot;
        isolHadEnv = envFilesUnder(buildRoot).length > 0;
        writeFileSync(path.join(buildRoot, ".env.planted"), "should-be-unlinked\n");
        writeFileSync(path.join(buildRoot, ".env"), "planted\n");
        return successfulHarnessBuild(buildRoot);
      },
    });
    expect(result.status).toBe(0);
    expect(isolHadEnv).toBe(false);
    expect(existsSync(isolPath)).toBe(false);
    expect(envFilesUnder(path.join(root, "out-e2e"))).toEqual([]);
    expect(leftoverIsolDirs(process.pid, root)).toEqual([]);
    expect(existsSync(path.join(root, E2E_BUILD_DIR))).toBe(false);
  });

  it("does not sweep another root's in-flight isolated tree", async () => {
    const rootA = tempDir();
    const rootB = tempDir();
    initTrackedRepo(rootA);
    initTrackedRepo(rootB);
    let isolA = "";
    let aResult;
    let releaseA;
    const aStarted = new Promise((resolve, reject) => {
      aResult = runBuildE2eStatic({
        root: rootA,
        handleSignals: false,
        runBuild: (buildRoot) => {
          isolA = buildRoot;
          writeFileSync(path.join(buildRoot, "SENTINEL"), "a");
          resolve();
          return new Promise((resolveBuild) => {
            releaseA = resolveBuild;
          });
        },
      }).catch(reject);
    });
    await aStarted;
    expect(existsSync(path.join(isolA, "SENTINEL"))).toBe(true);
    const staleB = path.join(tmpdir(), `${isolPrefixForRoot(rootB)}99999-STALE`);
    mkdirSync(staleB, { recursive: true });
    temps.push(staleB);
    const resultB = await runBuildE2eStatic({
      root: rootB,
      handleSignals: false,
      runBuild: successfulHarnessBuild,
    });
    expect(resultB.status).toBe(0);
    expect(existsSync(path.join(isolA, "SENTINEL"))).toBe(true);
    expect(existsSync(staleB)).toBe(false);
    releaseA({ status: 1 });
    await aResult;
  });

  it("restores a lone out-e2e.old-* to out-e2e before sweeping when live is missing", async () => {
    const root = tempDir();
    initTrackedRepo(root);
    const old = path.join(root, "out-e2e.old-99123");
    mkdirSync(old);
    writeFileSync(path.join(old, "index.html"), "PREVIOUS-GOOD");
    const crashedTmp = path.join(root, "out-e2e.tmp-99123");
    mkdirSync(crashedTmp);
    writeFileSync(path.join(crashedTmp, "index.html"), "NEW-UNPUBLISHED");
    const result = await runBuildE2eStatic({
      root,
      handleSignals: false,
      runBuild: () => ({ status: 1 }),
    });
    expect(result.status).toBe(1);
    expect(existsSync(path.join(root, "out-e2e", "index.html"))).toBe(true);
    expect(readFileSync(path.join(root, "out-e2e", "index.html"), "utf8")).toBe("PREVIOUS-GOOD");
    expect(existsSync(old)).toBe(false);
    expect(existsSync(crashedTmp)).toBe(false);
    expect(oldPublishDirs(root)).toEqual([]);
    expect(tmpPublishDirs(root)).toEqual([]);
  });

  it("restores the newest out-e2e.old-* when several orphans exist and live is missing", async () => {
    const root = tempDir();
    initTrackedRepo(root);
    const older = path.join(root, "out-e2e.old-10001");
    const newer = path.join(root, "out-e2e.old-10002");
    mkdirSync(older);
    writeFileSync(path.join(older, "index.html"), "OLDER");
    const past = new Date(Date.now() - 60_000);
    utimesSync(older, past, past);
    mkdirSync(newer);
    writeFileSync(path.join(newer, "index.html"), "NEWER");
    const result = await runBuildE2eStatic({
      root,
      handleSignals: false,
      runBuild: () => ({ status: 1 }),
    });
    expect(result.status).toBe(1);
    expect(existsSync(path.join(root, "out-e2e", "index.html"))).toBe(true);
    expect(readFileSync(path.join(root, "out-e2e", "index.html"), "utf8")).toBe("NEWER");
    expect(existsSync(older)).toBe(false);
    expect(existsSync(newer)).toBe(false);
    expect(oldPublishDirs(root)).toEqual([]);
  });
});
