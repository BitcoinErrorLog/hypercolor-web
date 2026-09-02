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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  E2E_BUILD_DIR,
  E2E_STATIC_LOCK_DIR,
  runBuildE2eStatic,
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
  const prefix = `hypercolor-e2e-isol-${pid}-`;
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

function tmpPublishDirs(root) {
  return readdirSync(root).filter((name) => name.startsWith("out-e2e.tmp-"));
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
});
