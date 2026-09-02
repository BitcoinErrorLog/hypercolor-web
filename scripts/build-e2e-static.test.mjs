import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  E2E_STATIC_LOCK_DIR,
  E2E_STATIC_STASH_PREFIX,
  listProdOutStashes,
  runBuildE2eStatic,
} from "./build-e2e-static.mjs";

const SCRIPT = fileURLToPath(new URL("./build-e2e-static.mjs", import.meta.url));
const temps = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "hc-e2e-static-"));
  temps.push(dir);
  return dir;
}

function writeProdOut(root, body = "prod") {
  const out = path.join(root, "out");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "index.html"), body);
}

function readOut(root) {
  const file = path.join(root, "out", "index.html");
  return existsSync(file) ? readFileSync(file, "utf8") : null;
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

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("build-e2e-static stash safety", () => {
  it("restores out/ when the child build fails", async () => {
    const root = tempDir();
    writeProdOut(root, "prod");
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
    expect(existsSync(path.join(root, "out-e2e"))).toBe(false);
    expect(existsSync(path.join(root, E2E_STATIC_LOCK_DIR))).toBe(false);
    expect(listProdOutStashes(root)).toEqual([]);
  });

  it(
    "restores out/ when the process receives SIGINT during the build",
    async () => {
      const root = tempDir();
      writeProdOut(root, "prod");
      const ready = path.join(root, ".ready");
      const childScript = path.join(root, "hang-build.mjs");
      writeFileSync(
        childScript,
        `
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runBuildE2eStatic } from ${JSON.stringify(SCRIPT)};

const root = ${JSON.stringify(root)};
const ready = ${JSON.stringify(ready)};

const result = await runBuildE2eStatic({
  root,
  runBuild: (buildRoot) => {
    mkdirSync(path.join(buildRoot, "out"), { recursive: true });
    writeFileSync(path.join(buildRoot, "out", "index.html"), "harness");
    writeFileSync(ready, "1");
    return new Promise(() => {
      setInterval(() => {}, 1000);
    });
  },
});
if (result.status !== 0 && result.error) {
  console.error(result.error);
}
process.exit(result.status);
`,
      );
      const child = spawn(process.execPath, [childScript], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.resume();
      child.stderr.resume();
      const exited = new Promise((resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      try {
        await waitForFile(ready);
        child.kill("SIGINT");
        const status = await exited;
        expect(status.signal === "SIGINT" || (status.code !== 0 && status.code !== null)).toBe(
          true,
        );
        expect(readOut(root)).toBe("prod");
        expect(existsSync(path.join(root, E2E_STATIC_LOCK_DIR))).toBe(false);
        expect(listProdOutStashes(root)).toEqual([]);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
    },
    15_000,
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

  it("restores a leftover stash when out/ is missing then builds", async () => {
    const root = tempDir();
    const leftover = path.join(root, `${E2E_STATIC_STASH_PREFIX}-old`);
    mkdirSync(leftover);
    writeFileSync(path.join(leftover, "index.html"), "stashed-prod");
    const result = await runBuildE2eStatic({
      root,
      handleSignals: false,
      runBuild: (buildRoot) => {
        mkdirSync(path.join(buildRoot, "out"), { recursive: true });
        writeFileSync(path.join(buildRoot, "out", "index.html"), "harness");
        writeFileSync(path.join(buildRoot, "out", ".e2e-harness"), "1\n");
        return { status: 0 };
      },
    });
    expect(result.status).toBe(0);
    expect(readOut(root)).toBe("stashed-prod");
    expect(readFileSync(path.join(root, "out-e2e", "index.html"), "utf8")).toBe("harness");
    expect(existsSync(path.join(root, "out-e2e", ".e2e-harness"))).toBe(true);
    expect(listProdOutStashes(root)).toEqual([]);
    expect(existsSync(path.join(root, E2E_STATIC_LOCK_DIR))).toBe(false);
  });

  it("refuses to delete a leftover stash when out/ already exists", async () => {
    const root = tempDir();
    writeProdOut(root, "prod");
    const leftover = path.join(root, `${E2E_STATIC_STASH_PREFIX}-old`);
    mkdirSync(leftover);
    writeFileSync(path.join(leftover, "index.html"), "stashed-prod");
    const result = await runBuildE2eStatic({
      root,
      handleSignals: false,
      runBuild: () => {
        throw new Error("must not run while a leftover stash conflicts with out/");
      },
    });
    expect(result.status).toBe(1);
    expect(result.error).toMatch(/leftover stash/);
    expect(readOut(root)).toBe("prod");
    expect(readFileSync(path.join(leftover, "index.html"), "utf8")).toBe("stashed-prod");
  });
});
