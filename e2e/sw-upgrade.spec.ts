import { spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { cacheNameFromWorkerFile } from "./sw-cache-name";

/**
 * Returning-visitor upgrade proof for the service worker.
 *
 * A first-time visitor never had the broken worker, so it proves nothing here.
 * The upgrade is simulated the way a deploy actually performs it: the bytes
 * served at `/sw.js` change under a live registration. `page.route` cannot be
 * used for this — Playwright does not intercept the browser's service-worker
 * script fetch — so the test rewrites the file the static server reads.
 *
 * CI / local static export (copies `out-e2e` so parallel specs are not poisoned):
 *
 *   npm run test:e2e:static
 *
 * Manual preview of that tree:
 *
 *   npm run preview:static -- --port 3300 --root out-e2e --allow-e2e-harness
 *
 * Optional rewrite-in-place against a server you already started:
 *
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3300 \
 *   SW_UPGRADE_SW_PATH=$PWD/out-e2e/sw.js \
 *   npx playwright test e2e/sw-upgrade.spec.ts
 */

const V2_PATH = join(__dirname, "fixtures", "sw-v2.js");
const V3_PATH = join(__dirname, "fixtures", "sw-v3.js");
const CURRENT_SW_PATH = join(__dirname, "..", "public", "sw.js");
const OUT_E2E = join(__dirname, "..", "out-e2e");
const CURRENT_CACHE = cacheNameFromWorkerFile(CURRENT_SW_PATH);
const V2_CACHE = cacheNameFromWorkerFile(V2_PATH);
const V3_CACHE = cacheNameFromWorkerFile(V3_PATH);

type WorkerVersion = "v2" | "v3" | "current";

function workerFile(version: WorkerVersion): string {
  if (version === "v2") return V2_PATH;
  if (version === "v3") return V3_PATH;
  return CURRENT_SW_PATH;
}

function serveWorkerVersion(servedSw: string, version: WorkerVersion): void {
  copyFileSync(workerFile(version), servedSw);
}

async function cacheKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => caches.keys());
}

async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
}

async function waitForController(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: timeoutMs,
  });
}

/** Issues a Flight request the way the App Router does for a `<Link>` transition. */
async function fetchFlight(page: Page, path: string): Promise<number> {
  return page.evaluate(async (target) => {
    const response = await fetch(target, {
      headers: { RSC: "1", "Next-Router-State-Tree": "%5B%22%22%2C%7B%7D%5D" },
    });
    return response.status;
  }, path);
}

async function becomeReturningVisitor(
  page: Page,
  baseUrl: string,
  servedSw: string,
  version: "v2" | "v3",
): Promise<void> {
  serveWorkerVersion(servedSw, version);
  await page.goto(`${baseUrl}/enable`, { waitUntil: "domcontentloaded" });
  await waitForController(page);
  const expected = version === "v2" ? V2_CACHE : V3_CACHE;
  await expect.poll(async () => cacheKeys(page), { timeout: 30_000 }).toContain(expected);
  if (version === "v2") {
    expect(await fetchFlight(page, "/chats?_rsc=proof")).toBe(200);
    await expect
      .poll(async () => (await cachedUrls(page)).some((url) => url.includes("_rsc=proof")), {
        timeout: 30_000,
      })
      .toBe(true);
  }
}

async function upgradeToCurrent(page: Page, servedSw: string, expectedCache: string): Promise<void> {
  serveWorkerVersion(servedSw, "current");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(
      async () => {
        await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          await registration?.update().catch(() => undefined);
          const waiting = registration?.waiting ?? registration?.installing;
          waiting?.postMessage({ type: "hypercolor-skip-waiting" });
        });
        return cacheKeys(page);
      },
      { timeout: 90_000, intervals: [1_000] },
    )
    .toEqual([expectedCache]);
  await waitForController(page);
}

async function withServedExport(
  run: (ctx: { baseUrl: string; servedSw: string }) => Promise<void>,
): Promise<void> {
  const explicitBase = process.env.PLAYWRIGHT_BASE_URL?.trim() ?? "";
  const explicitSw = process.env.SW_UPGRADE_SW_PATH?.trim() ?? "";
  if (explicitBase && explicitSw) {
    await run({ baseUrl: explicitBase.replace(/\/$/, ""), servedSw: explicitSw });
    return;
  }
  if (!existsSync(join(OUT_E2E, "sw.js"))) {
    throw new Error("out-e2e/sw.js is missing; run npm run test:e2e:static / npm run build:e2e:static");
  }
  const root = mkdtempSync(join(tmpdir(), "hc-sw-upgrade-"));
  cpSync(OUT_E2E, root, { recursive: true });
  const preview = await spawnStaticPreview(root);
  try {
    await run({ baseUrl: preview.url, servedSw: join(root, "sw.js") });
  } finally {
    await preview.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/** Playwright compiles specs as CJS; spawn the ESM preview instead of importing it. */
function spawnStaticPreview(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const child = spawn(
    process.execPath,
    [
      join(__dirname, "..", "scripts", "static-preview.mjs"),
      "--root",
      root,
      "--port",
      "0",
      "--host",
      "127.0.0.1",
      "--allow-e2e-harness",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let started = false;
    const fail = (err: Error) => {
      if (started) return;
      started = true;
      reject(err);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = stdout.match(/static preview: (http:\/\/[^\s]+)/);
      if (!match || started) return;
      started = true;
      resolve({
        url: match[1],
        close: () =>
          new Promise((closeResolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              closeResolve();
              return;
            }
            child.once("exit", () => closeResolve());
            child.kill("SIGTERM");
            setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
            }, 2000);
          }),
      });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", fail);
    child.once("exit", (code, signal) => {
      if (started) return;
      fail(new Error(`static-preview exited ${code ?? signal}: ${stdout}${stderr}`));
    });
  });
}

test.describe("service worker upgrade", () => {
  test.describe.configure({ mode: "serial" });

  test("upgrading away from v2 purges its poisoned Flight cache", async ({ page }) => {
    test.setTimeout(180_000);
    await withServedExport(async ({ baseUrl, servedSw }) => {
      try {
        await becomeReturningVisitor(page, baseUrl, servedSw, "v2");
        await upgradeToCurrent(page, servedSw, CURRENT_CACHE);

        const keys = await cacheKeys(page);
        expect(keys).toContain(CURRENT_CACHE);
        expect(keys).not.toContain(V2_CACHE);
        expect((await cachedUrls(page)).filter((url) => url.includes("_rsc="))).toEqual([]);

        expect(await fetchFlight(page, "/chats?_rsc=proof2")).toBe(200);
        await page.waitForTimeout(3_000);
        expect((await cachedUrls(page)).filter((url) => url.includes("_rsc="))).toEqual([]);
      } finally {
        serveWorkerVersion(servedSw, "current");
      }
    });
  });

  test("upgrading from v3 to the current worker purges the v3 cache", async ({ page }) => {
    test.setTimeout(180_000);
    expect(V3_CACHE).not.toBe(CURRENT_CACHE);
    await withServedExport(async ({ baseUrl, servedSw }) => {
      try {
        await becomeReturningVisitor(page, baseUrl, servedSw, "v3");
        await upgradeToCurrent(page, servedSw, CURRENT_CACHE);
        const keys = await cacheKeys(page);
        expect(keys).toEqual([CURRENT_CACHE]);
        expect(keys).not.toContain(V3_CACHE);
      } finally {
        serveWorkerVersion(servedSw, "current");
      }
    });
  });
});
