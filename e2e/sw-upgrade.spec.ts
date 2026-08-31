import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";

/**
 * Returning-visitor upgrade proof for the service worker.
 *
 * A first-time visitor never had the broken worker, so it proves nothing here.
 * These tests install the historical v2 worker first, confirm it controls the
 * page and that it caches Flight/RSC responses cache-first, then let the
 * deployed v3 worker take over and assert the defect is gone.
 */

const V2_SOURCE = readFileSync(join(__dirname, "fixtures", "sw-v2.js"), "utf8");
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "";
const INVITE_SCRIPT =
  process.env.PUBKY_STAGING_INVITE_SCRIPT ??
  "/Users/johncarvalho/.cursor/skills/pubky-staging-invite/scripts/generate.sh";

const execFileAsync = promisify(execFile);

type CacheProbe = { keys: string[]; entries: string[] };

async function readCaches(page: Page): Promise<CacheProbe> {
  return page.evaluate(async () => {
    const keys = await caches.keys();
    const entries: string[] = [];
    for (const key of keys) {
      const cache = await caches.open(key);
      for (const request of await cache.keys()) entries.push(request.url);
    }
    return { keys, entries };
  });
}

async function controllerScript(page: Page): Promise<string | null> {
  return page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
}

async function waitForController(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: timeoutMs,
  });
}

async function waitForCacheNamed(page: Page, name: string, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    async (expected) => (await caches.keys()).includes(expected as string),
    name,
    { timeout: timeoutMs },
  );
}

/** Issues a Flight request the way the App Router does for a `<Link>` transition. */
async function fetchFlight(page: Page, path: string): Promise<{ status: number; type: string }> {
  return page.evaluate(async (target) => {
    const response = await fetch(target, {
      headers: { RSC: "1", "Next-Router-State-Tree": "%5B%22%22%2C%7B%7D%5D" },
    });
    return {
      status: response.status,
      type: response.headers.get("content-type") ?? "",
    };
  }, path);
}

async function installV2(page: Page): Promise<void> {
  await page.route("**/sw.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      headers: { "cache-control": "no-store" },
      body: V2_SOURCE,
    }),
  );
  await page.goto(`${BASE_URL}/enable`, { waitUntil: "domcontentloaded" });
  await waitForController(page);
  await waitForCacheNamed(page, "hypercolor-shell-v2");
}

test.describe("service worker v2 → v3 upgrade", () => {
  test.skip(!BASE_URL, "Set PLAYWRIGHT_BASE_URL to the deployment under test.");

  test("v2 caches Flight responses, and the deployed worker upgrades away from it", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await installV2(page);
    expect(await controllerScript(page)).toContain("/sw.js");

    // Reproduce the production defect: v2's shouldCache() matches on pathname
    // only, so a Flight request for /chats is stored under its ?_rsc= key and
    // then served cache-first forever, including across deployments.
    const flightUnderV2 = await fetchFlight(page, "/chats?_rsc=proof");
    expect(flightUnderV2.status).toBe(200);
    await expect
      .poll(async () => (await readCaches(page)).entries.some((url) => url.includes("_rsc=proof")), {
        timeout: 15_000,
      })
      .toBe(true);

    const beforeUpgrade = await readCaches(page);
    expect(beforeUpgrade.keys).toContain("hypercolor-shell-v2");

    // Stop serving v2 and let the real deployment hand over the v3 worker.
    await page.unroute("**/sw.js");
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForCacheNamed(page, "hypercolor-shell-v3", 60_000);

    const afterUpgrade = await readCaches(page);
    expect(afterUpgrade.keys).toContain("hypercolor-shell-v3");
    // v3's activate handler purges every cache but its own, taking the poisoned
    // Flight entries with it.
    expect(afterUpgrade.keys).not.toContain("hypercolor-shell-v2");
    expect(afterUpgrade.entries.filter((url) => url.includes("_rsc="))).toEqual([]);

    // v3 must not intercept Flight at all, so nothing new gets cached either.
    const flightUnderV3 = await fetchFlight(page, "/chats?_rsc=proof2");
    expect(flightUnderV3.status).toBe(200);
    await page.waitForTimeout(2_000);
    const afterFlight = await readCaches(page);
    expect(afterFlight.entries.filter((url) => url.includes("_rsc="))).toEqual([]);
  });

  test("a returning v2 visitor can open chats after enabling messaging", async ({ page }) => {
    test.setTimeout(300_000);
    test.skip(
      process.env.RUN_SW_UPGRADE_ENABLE !== "1",
      "Set RUN_SW_UPGRADE_ENABLE=1 against a deployment built with NEXT_PUBLIC_E2E_HARNESS=1.",
    );

    await installV2(page);
    const v2Caches = await readCaches(page);
    expect(v2Caches.keys).toContain("hypercolor-shell-v2");

    // Poison the Flight cache exactly as a real returning visitor would have.
    await fetchFlight(page, "/chats?_rsc=proof");
    await expect
      .poll(async () => (await readCaches(page)).entries.some((url) => url.includes("_rsc=proof")), {
        timeout: 15_000,
      })
      .toBe(true);

    // Now serve the new build and let v3 claim the client.
    await page.unroute("**/sw.js");

    const { stdout } = await execFileAsync("bash", [INVITE_SCRIPT], { timeout: 20_000 });
    const token = stdout.trim();
    expect(token).not.toBe("");

    await page.goto(`${BASE_URL}/e2e/dm-harness`, { waitUntil: "domcontentloaded" });
    await waitForCacheNamed(page, "hypercolor-shell-v3", 60_000);
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

    // The click the bug report says hangs. No noWaitAfter: we want the
    // navigation to actually settle.
    const firstClickStart = Date.now();
    await openChats.click();
    await expect(page).toHaveURL(/\/chats(\/|\?|$)/, { timeout: 60_000 });
    await expect(page.getByTestId("chatsScreen")).toBeVisible({ timeout: 60_000 });
    const firstClickMs = Date.now() - firstClickStart;
    console.info(`[sw-upgrade] Open chats settled in ${firstClickMs}ms`);
    // Enabled state must survive the transition, so the Enable CTA must not
    // reappear on the chats screen.
    expect(await page.getByTestId("chatsEnableMessaging").count()).toBe(0);

    // Task 2 item 3: enabled state is derived from the session and the KeyStore
    // receiver secret, so it must survive a full document reload.
    await page.goto(`${BASE_URL}/enable`, { waitUntil: "domcontentloaded" });
    await expect(status).toHaveText("Encrypted messaging enabled", { timeout: 90_000 });

    // Task 2 item 2: the same click again after a reload.
    const secondClickStart = Date.now();
    await page.getByRole("link", { name: "Open chats" }).click();
    await expect(page).toHaveURL(/\/chats(\/|\?|$)/, { timeout: 60_000 });
    await expect(page.getByTestId("chatsScreen")).toBeVisible({ timeout: 60_000 });
    const secondClickMs = Date.now() - secondClickStart;
    console.info(`[sw-upgrade] Open chats after reload settled in ${secondClickMs}ms`);
    expect(await page.getByTestId("chatsEnableMessaging").count()).toBe(0);
  });
});
