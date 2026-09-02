import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Returning-visitor upgrade proof for the service worker.
 *
 * A first-time visitor never had the broken worker, so it proves nothing here.
 * The upgrade is simulated the way a deploy actually performs it: the bytes
 * served at `/sw.js` change under a live registration. `page.route` cannot be
 * used for this — Playwright does not intercept the browser's service-worker
 * script fetch — so the test rewrites the file the static server reads.
 *
 *   NEXT_PUBLIC_E2E_HARNESS=1 npm run build && npm run preview:static
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 \
 *   SW_UPGRADE_SW_PATH=$PWD/out/sw.js \
 *   npx playwright test e2e/sw-upgrade.spec.ts
 */

const V2_PATH = join(__dirname, "fixtures", "sw-v2.js");
const V3_PATH = join(__dirname, "..", "public", "sw.js");
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "";
const SERVED_SW = process.env.SW_UPGRADE_SW_PATH ?? "";

function serveWorkerVersion(version: "v2" | "v3"): void {
  copyFileSync(version === "v2" ? V2_PATH : V3_PATH, SERVED_SW);
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

/** Loads the origin under v2 until it controls the page and has cached Flight. */
async function becomeReturningV2Visitor(page: Page): Promise<void> {
  serveWorkerVersion("v2");
  await page.goto(`${BASE_URL}/enable`, { waitUntil: "domcontentloaded" });
  await waitForController(page);
  await expect
    .poll(async () => cacheKeys(page), { timeout: 30_000 })
    .toContain("hypercolor-shell-v2");

  // v2's shouldCache() matches on pathname only while cache.put() keys by full
  // URL, so a Flight request for /chats lands under its ?_rsc= key and is then
  // served cache-first forever, including across deployments.
  expect(await fetchFlight(page, "/chats?_rsc=proof")).toBe(200);
  await expect
    .poll(async () => (await cachedUrls(page)).some((url) => url.includes("_rsc=proof")), {
      timeout: 30_000,
    })
    .toBe(true);
}

/**
 * Simulates the deploy and waits for the new worker to activate. The v3 cache
 * appears during *install*; v2's poisoned cache is only dropped in v3's
 * `activate` handler, so activation is what has to be waited on.
 */
async function upgradeToV3(page: Page): Promise<void> {
  serveWorkerVersion("v3");
  await page.reload({ waitUntil: "domcontentloaded" });
  // A real browser re-checks the script on navigation. The local static server
  // adds ETag/Cache-Control of its own, so drive the check explicitly rather
  // than depending on when the browser gets around to it.
  await expect
    .poll(
      async () => {
        await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          await registration?.update().catch(() => undefined);
        });
        return cacheKeys(page);
      },
      { timeout: 90_000, intervals: [1_000] },
    )
    .toEqual(["hypercolor-shell-v3"]);
  await waitForController(page);
}

test.describe("service worker v2 → v3 upgrade", () => {
  // Both tests rewrite the sw.js the server reads, so they cannot overlap.
  test.describe.configure({ mode: "serial" });
  test.skip(!BASE_URL, "Set PLAYWRIGHT_BASE_URL to the deployment under test.");
  test.skip(
    !SERVED_SW,
    "Set SW_UPGRADE_SW_PATH to the sw.js the server reads, so the deploy can be simulated.",
  );

  test("upgrading away from v2 purges its poisoned Flight cache", async ({ page }) => {
    test.setTimeout(180_000);
    try {
      await becomeReturningV2Visitor(page);
      await upgradeToV3(page);

      const keys = await cacheKeys(page);
      expect(keys).toContain("hypercolor-shell-v3");
      // v3's activate handler drops every cache but its own, taking the
      // poisoned Flight entries with it.
      expect(keys).not.toContain("hypercolor-shell-v2");
      expect((await cachedUrls(page)).filter((url) => url.includes("_rsc="))).toEqual([]);

      // v3 must not intercept Flight at all, so nothing new is cached either.
      expect(await fetchFlight(page, "/chats?_rsc=proof2")).toBe(200);
      await page.waitForTimeout(3_000);
      expect((await cachedUrls(page)).filter((url) => url.includes("_rsc="))).toEqual([]);
    } finally {
      serveWorkerVersion("v3");
    }
  });

  // The enable -> "Open chats" path is proved by sw-upgrade-live.spec.ts against
  // a real deployment instead of here. This harness serves over HTTP/1.1, where
  // the browser allows six connections per origin, and the v2 worker issues an
  // outbound fetch() for every same-origin GET even when it answers from cache.
  // The resulting revalidation storm starves the static server, so the v3 worker
  // stalls in "installed" and the run fails for a reason that has nothing to do
  // with the product.
});
