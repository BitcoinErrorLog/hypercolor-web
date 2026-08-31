import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Returning-visitor upgrade proof against real production.
 *
 * `sw-upgrade-live.spec.ts` simulated a deploy by repointing a Vercel alias
 * between two preview builds, because a preview pair was the only place a
 * "before" build existed. Production now serves the new worker, so the shape of
 * the proof inverts: the browser is seeded with the historical worker by
 * fulfilling the registration's script fetch from the checked-in v2 fixture, and
 * the "deploy" is dropping that interception so the origin's own bytes take
 * over. Nothing about the origin is modified.
 *
 *   RUN_PROD_SW_GATE=1 npx playwright test e2e/sw-upgrade-prod.spec.ts
 */

const ORIGIN = process.env.SW_UPGRADE_ORIGIN?.trim() ?? "https://hypercolor.app";
const V2 = readFileSync(join(__dirname, "fixtures", "sw-v2.js"), "utf8");

function elapsed(from: number): number {
  return Math.round(performance.now() - from);
}

/**
 * Serve the historical worker for the registration's own script fetch, so the
 * browser arrives at production already controlled by v2.
 */
async function serveHistoricalWorker(context: BrowserContext): Promise<void> {
  await context.route(`${ORIGIN}/sw.js`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      headers: { "cache-control": "public, max-age=0, must-revalidate" },
      body: V2,
    });
  });
}

async function controllerState(page: Page): Promise<{ url: string | null; state: string | null }> {
  return page.evaluate(() => ({
    url: navigator.serviceWorker.controller?.scriptURL ?? null,
    state: navigator.serviceWorker.controller?.state ?? null,
  }));
}

async function cacheKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => caches.keys());
}

async function cachedUrls(page: Page, key: string): Promise<string[]> {
  return page.evaluate(async (name) => {
    if (!(await caches.has(name))) return [];
    const cache = await caches.open(name);
    return (await cache.keys()).map((request) => request.url);
  }, key);
}

async function servedWorkerCache(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch("/sw.js", { cache: "no-store" });
    const body = await response.text();
    return body.match(/hypercolor-shell-v[0-9]+/)?.[0] ?? "none";
  });
}

async function waitForController(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () =>
      navigator.serviceWorker.controller !== null &&
      navigator.serviceWorker.controller.state === "activated",
    undefined,
    { timeout: timeoutMs },
  );
}

/** Ask the App Router for a Flight payload the way a client transition does. */
async function fetchFlight(page: Page, path: string): Promise<number> {
  return page.evaluate(async (target) => {
    const response = await fetch(`${target}?_rsc=probe`, { headers: { RSC: "1" } });
    return response.status;
  }, path);
}

test("a returning v2 visitor on production upgrades to v3 and can navigate", async () => {
  test.setTimeout(300_000);
  test.skip(
    process.env.RUN_PROD_SW_GATE !== "1",
    "Set RUN_PROD_SW_GATE=1 to run the production service-worker gate.",
  );

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: "allow" });
    await serveHistoricalWorker(context);
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") console.info(`[page-error] ${message.text()}`);
    });

    // 1. Become a returning visitor whose browser is still controlled by v2.
    const installStart = performance.now();
    await page.goto(`${ORIGIN}/enable`, { waitUntil: "domcontentloaded" });
    await waitForController(page);
    const v2Controller = await controllerState(page);
    console.info(
      `[prod] v2 controlling after ${elapsed(installStart)}ms controller=${v2Controller.url} state=${v2Controller.state}`,
    );
    expect(v2Controller.url).toBe(`${ORIGIN}/sw.js`);
    await expect
      .poll(() => cacheKeys(page), { timeout: 30_000 })
      .toContain("hypercolor-shell-v2");
    expect(await servedWorkerCache(page)).toBe("hypercolor-shell-v2");

    // 2. v2 caches a Flight payload under the document URL. That entry is what
    //    later breaks client navigation: the router asks for Flight and v2
    //    answers from cache with whatever it stored first.
    expect(await fetchFlight(page, "/chats")).toBe(200);
    await expect
      .poll(() => cachedUrls(page, "hypercolor-shell-v2"), { timeout: 20_000 })
      .toEqual(expect.arrayContaining([`${ORIGIN}/chats?_rsc=probe`]));
    console.info("[prod] v2 cached a Flight response under /chats?_rsc=probe");

    // 3. The deploy: production's own worker bytes become visible to this
    //    browser. /sw.js is served max-age=0, must-revalidate, so the next
    //    navigation's update check sees new bytes.
    await context.unroute(`${ORIGIN}/sw.js`);
    expect(await servedWorkerCache(page)).toBe("hypercolor-shell-v3");

    const upgradeStart = performance.now();
    let loads = 0;
    let takeover = false;
    for (let attempt = 0; attempt < 6 && !takeover; attempt += 1) {
      loads += 1;
      const loadStart = performance.now();
      await page.goto(`${ORIGIN}/enable`, { waitUntil: "domcontentloaded" });
      takeover = await Promise.resolve(
        expect
          .poll(() => cacheKeys(page), { timeout: 20_000, intervals: [250] })
          .toEqual(["hypercolor-shell-v3"]),
      ).then(
        () => true,
        () => false,
      );
      console.info(
        `[prod] load ${loads}: takeover=${takeover} in ${elapsed(loadStart)}ms caches=${await cacheKeys(page)}`,
      );
    }
    expect(await cacheKeys(page)).toEqual(["hypercolor-shell-v3"]);
    await waitForController(page);
    console.info(
      `[prod] v3 took over after ${loads} load(s) in ${elapsed(upgradeStart)}ms; v2 cache purged`,
    );

    // 4. v3 leaves Flight alone, so the router always talks to the network.
    expect(await fetchFlight(page, "/chats")).toBe(200);
    await page.waitForTimeout(1_000);
    expect(await cachedUrls(page, "hypercolor-shell-v3")).not.toContain(
      `${ORIGIN}/chats?_rsc=probe`,
    );
    console.info("[prod] v3 did not cache the Flight response");

    // 5. Client navigation commits and paints. The defect left the URL alone
    //    and never rendered, so assert on what a visitor can see.
    const navStart = performance.now();
    await page.getByRole("link", { name: "Chats" }).click();
    await expect(page.getByRole("heading", { name: "Chats", level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByPlaceholder("Paste a pubky to start a chat")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/chats");
    console.info(`[prod] client navigation to /chats painted in ${elapsed(navStart)}ms`);

    await page.screenshot({ path: "/tmp/hc-gate/leg1-chats.png", fullPage: true });
  } finally {
    await browser.close();
  }
});
