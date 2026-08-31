import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
 *   npm run build && npx serve out -p 3000
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 \
 *   SW_UPGRADE_SW_PATH=$PWD/out/sw.js \
 *   npx playwright test e2e/sw-upgrade.spec.ts
 */

const V2_PATH = join(__dirname, "fixtures", "sw-v2.js");
const V3_PATH = join(__dirname, "..", "public", "sw.js");
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "";
const SERVED_SW = process.env.SW_UPGRADE_SW_PATH ?? "";
const INVITE_SCRIPT =
  process.env.PUBKY_STAGING_INVITE_SCRIPT ??
  "/Users/johncarvalho/.cursor/skills/pubky-staging-invite/scripts/generate.sh";

const execFileAsync = promisify(execFile);

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

  test("a returning v2 visitor can open chats after enabling messaging", async ({ page }) => {
    test.setTimeout(300_000);
    test.skip(
      process.env.RUN_SW_UPGRADE_ENABLE !== "1",
      "Set RUN_SW_UPGRADE_ENABLE=1 against a build made with NEXT_PUBLIC_E2E_HARNESS=1.",
    );

    try {
      await becomeReturningV2Visitor(page);
      await upgradeToV3(page);

      const { stdout } = await execFileAsync("bash", [INVITE_SCRIPT], { timeout: 20_000 });
      const token = stdout.trim();
      expect(token).not.toBe("");

      await page.goto(`${BASE_URL}/e2e/dm-harness`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () =>
          typeof (window as unknown as { runDmSignup?: unknown }).runDmSignup === "function",
        null,
        { timeout: 60_000 },
      );
      const signup = await page.evaluate(async (signupToken) => {
        const run = (
          window as unknown as {
            runDmSignup?: (value: string) => Promise<{ pubky: string; receiverPath: string }>;
          }
        ).runDmSignup;
        if (!run) throw new Error("window.runDmSignup is not installed");
        return run(signupToken);
      }, token);
      expect(signup.pubky).toHaveLength(52);

      await page.goto(`${BASE_URL}/enable`, { waitUntil: "domcontentloaded" });
      const status = page.getByTestId("enableMessagingStatus");
      await expect(status).toHaveText("Encrypted messaging enabled", { timeout: 90_000 });

      const openChats = page.getByRole("link", { name: "Open chats" });
      await expect(openChats).toBeVisible({ timeout: 30_000 });

      // The click the bug report says hangs. No noWaitAfter: the navigation
      // has to actually settle.
      const firstStart = Date.now();
      await openChats.click();
      await expect(page).toHaveURL(/\/chats(\/|\?|$)/, { timeout: 60_000 });
      await expect(page.getByTestId("chatsScreen")).toBeVisible({ timeout: 60_000 });
      console.info(`[sw-upgrade] Open chats settled in ${Date.now() - firstStart}ms`);
      // Enabled status must survive the transition, so the Enable CTA must not
      // come back on the chats screen.
      expect(await page.getByTestId("chatsEnableMessaging").count()).toBe(0);

      // Enabled status is derived from the live session plus the KeyStore
      // receiver secret, so it must survive a full document reload.
      await page.goto(`${BASE_URL}/enable`, { waitUntil: "domcontentloaded" });
      await expect(status).toHaveText("Encrypted messaging enabled", { timeout: 90_000 });

      const secondStart = Date.now();
      await page.getByRole("link", { name: "Open chats" }).click();
      await expect(page).toHaveURL(/\/chats(\/|\?|$)/, { timeout: 60_000 });
      await expect(page.getByTestId("chatsScreen")).toBeVisible({ timeout: 60_000 });
      console.info(
        `[sw-upgrade] Open chats after reload settled in ${Date.now() - secondStart}ms`,
      );
      expect(await page.getByTestId("chatsEnableMessaging").count()).toBe(0);
    } finally {
      serveWorkerVersion("v3");
    }
  });
});
