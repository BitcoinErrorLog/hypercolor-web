import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium, expect, test, type Page } from "@playwright/test";
import { cacheNameFromWorkerFile } from "./sw-cache-name";

/**
 * Returning-visitor upgrade proof against a real deployment.
 *
 * The local file-swap proof in `sw-upgrade.spec.ts` runs over HTTP/1.1, where
 * the browser allows six connections per origin. The v2 worker issues an
 * outbound `fetch()` for every same-origin GET even when it answers from cache,
 * so a local static server starves and navigations queue behind the revalidation
 * storm. That is a property of the harness, not of the product, and it masks the
 * defect under test. This spec therefore runs against a real HTTP/2 origin and
 * performs the upgrade the way a deploy does: by repointing an alias from a
 * build that serves the old worker to a build that serves the new one.
 *
 *   SW_UPGRADE_ALIAS=<host> \
 *   SW_UPGRADE_TARGET_DEPLOYMENT=<host serving the new worker> \
 *   VERCEL_PROTECTION_BYPASS=<automation bypass secret> \
 *   PUBKY_STAGING_INVITE_SCRIPT=<script printing a signup token> \
 *   RUN_STAGING_DM=1 \
 *   npx playwright test e2e/sw-upgrade-live.spec.ts
 */

const execFileAsync = promisify(execFile);

const ALIAS = process.env.SW_UPGRADE_ALIAS?.trim() ?? "";
const TARGET = process.env.SW_UPGRADE_TARGET_DEPLOYMENT?.trim() ?? "";
const BYPASS = process.env.VERCEL_PROTECTION_BYPASS?.trim() ?? "";
const GENERATE = process.env.PUBKY_STAGING_INVITE_SCRIPT?.trim() ?? "";
const CURRENT_CACHE = cacheNameFromWorkerFile(join(__dirname, "..", "public", "sw.js"));

type SignupResult = { pubky: string; receiverPath: string };

function elapsed(from: number): number {
  return Math.round(performance.now() - from);
}

async function mintToken(): Promise<string> {
  const explicit = process.env.STAGING_SIGNUP_TOKEN?.trim();
  if (explicit) return explicit;
  if (!GENERATE) {
    throw new Error(
      "set STAGING_SIGNUP_TOKEN, or PUBKY_STAGING_INVITE_SCRIPT to a script that prints one",
    );
  }
  const { stdout } = await execFileAsync("bash", [GENERATE], { timeout: 20_000 });
  const token = stdout.trim();
  if (!token) throw new Error("staging invite script returned an empty token");
  return token;
}

async function repointAlias(deployment: string): Promise<void> {
  await execFileAsync("vercel", ["alias", "set", deployment, ALIAS], {
    timeout: 120_000,
  });
}

/**
 * Wait until the edge actually serves the new worker *to this browser*. Without
 * this the reload below can race alias propagation, the update check compares
 * the old bytes against themselves, and nothing further triggers another check —
 * which looks exactly like a worker that refuses to upgrade.
 *
 * The probe has to run inside the page. A protected deployment varies on the
 * bypass cookie, so a request authenticated with the bypass header can be served
 * the new build while the browser's own cookie-authenticated request is still
 * served the old one.
 */
async function waitForServedWorker(page: Page, marker: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const body = await page.evaluate(async () => {
      const response = await fetch("/sw.js", { cache: "no-store" });
      return response.text();
    });
    if (body.includes(marker)) return;
    if (Date.now() > deadline) {
      throw new Error(`edge never served a worker containing ${marker}`);
    }
    await page.waitForTimeout(1_000);
  }
}

async function controllerUrl(page: Page): Promise<string | null> {
  return page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
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

async function waitForController(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () =>
      navigator.serviceWorker.controller !== null &&
      navigator.serviceWorker.controller.state === "activated",
    undefined,
    { timeout: timeoutMs },
  );
}

/**
 * Assert the chats screen actually rendered, on user-visible content only.
 * A settled URL is not enough: the defect left the URL alone and never
 * committed the transition.
 */
async function expectChatsSettled(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Chats", level: 1 })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByPlaceholder("Paste a pubky to start a chat")).toBeVisible();
  await expect(page.getByText("No chats yet.")).toBeVisible();
  // Messaging is enabled, so the chats screen must not still be asking for it.
  await expect(
    page.getByText("Encrypted chats need a Ring-approved Paykit session on this device."),
  ).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/chats");
}

/** Ask the App Router for a Flight payload the way a client transition does. */
async function fetchFlight(page: Page, path: string): Promise<number> {
  return page.evaluate(async (target) => {
    const response = await fetch(`${target}?_rsc=probe`, {
      headers: { RSC: "1" },
    });
    return response.status;
  }, path);
}

test("a returning v2 visitor upgrades, enables messaging, and opens chats", async () => {
  test.setTimeout(600_000);
  test.skip(
    !ALIAS || !TARGET || !BYPASS,
    [
      "Live SW upgrade proof skipped (needs a real deployment pair).",
      "Deploy one build serving the old worker, alias it, deploy a second",
      "serving the new worker, then rerun with:",
      "  SW_UPGRADE_ALIAS=<host> SW_UPGRADE_TARGET_DEPLOYMENT=<host>",
      "  VERCEL_PROTECTION_BYPASS=<secret> RUN_STAGING_DM=1",
    ].join("\n"),
  );

  const base = `https://${ALIAS}`;
  const token = await mintToken();

  const browser = await chromium.launch();
  try {
    // Preview deployments sit behind SSO. Take the bypass once as a first-party
    // cookie rather than per-request headers, so the browser's own service-worker
    // script fetches are authenticated too.
    const context = await browser.newContext({ serviceWorkers: "allow" });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") console.info(`[page-error] ${message.text()}`);
    });

    // 1. Become a returning visitor: v2 installed, controlling, and holding the
    //    stale Flight payload that breaks client navigation.
    const installStart = performance.now();
    await page.goto(
      BYPASS
        ? `${base}/enable?x-vercel-protection-bypass=${BYPASS}&x-vercel-set-bypass-cookie=true`
        : `${base}/enable`,
      { waitUntil: "domcontentloaded" },
    );
    await waitForController(page);
    const v2Controller = await controllerUrl(page);
    console.info(
      `[live] v2 controlling after ${elapsed(installStart)}ms controller=${v2Controller}`,
    );
    expect(v2Controller).toBe(`${base}/sw.js`);
    await expect.poll(() => cacheKeys(page), { timeout: 30_000 }).toContain(
      "hypercolor-shell-v2",
    );

    const flightStatus = await fetchFlight(page, "/chats");
    expect(flightStatus).toBe(200);
    await expect
      .poll(() => cachedUrls(page, "hypercolor-shell-v2"), { timeout: 20_000 })
      .toEqual(expect.arrayContaining([`${base}/chats?_rsc=probe`]));
    console.info("[live] v2 cached a Flight response under /chats?_rsc=probe");

    // 2. Deploy: the bytes at /sw.js change under the live registration.
    const aliasStart = performance.now();
    await repointAlias(TARGET);
    await waitForServedWorker(page, CURRENT_CACHE);
    console.info(`[live] new worker live at the edge in ${elapsed(aliasStart)}ms`);

    // 3. The returning visitor comes back. /sw.js is served max-age=0, so every
    //    navigation triggers an update check; a visitor who opens the app more
    //    than once gets more than one chance at it.
    const upgradeStart = performance.now();
    let loads = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      loads += 1;
      await page.goto(`${base}/enable`, { waitUntil: "domcontentloaded" });
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      });
      const settled = await Promise.resolve(
        expect
          .poll(() => cacheKeys(page), { timeout: 20_000, intervals: [500] })
          .toEqual([CURRENT_CACHE]),
      ).then(
        () => true,
        () => false,
      );
      if (settled) break;
      console.info(`[live] no takeover after load ${loads}; caches=${await cacheKeys(page)}`);
    }
    expect(await cacheKeys(page)).toEqual([CURRENT_CACHE]);
    const upgradeMs = elapsed(upgradeStart);
    await waitForController(page);
    console.info(
      `[live] current worker took over after ${loads} load(s) in ${upgradeMs}ms; v2 cache purged`,
    );

    // 4. Enable encrypted messaging. This is the same durable state Ring
    //    approval produces: a live session plus a KeyStore receiver secret.
    await page.goto(`${base}/e2e/dm-harness`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.runDmSignup === "function", undefined, {
      timeout: 60_000,
    });
    const signupStart = performance.now();
    const signup = await page.evaluate(async (value) => {
      const run = (
        window as unknown as { runDmSignup?: (t: string) => Promise<SignupResult> }
      ).runDmSignup;
      if (!run) throw new Error("window.runDmSignup is not installed");
      return run(value);
    }, token);
    console.info(
      `[live] enabled in ${elapsed(signupStart)}ms pubky=${signup.pubky.slice(0, 12)}…`,
    );

    // 5. The click that hangs in production.
    await page.goto(`${base}/enable`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("enableMessagingStatus")).toHaveText(
      "Encrypted messaging enabled",
      { timeout: 60_000 },
    );
    const openChats = page.getByRole("link", { name: "Open chats" });
    await expect(openChats).toBeVisible();

    const clickStart = performance.now();
    await openChats.click();
    await expectChatsSettled(page);
    console.info(`[live] first Open chats settled in ${elapsed(clickStart)}ms`);

    // 6. The same click after a reload, and the enabled state surviving it.
    await page.goto(`${base}/enable`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("enableMessagingStatus")).toHaveText(
      "Encrypted messaging enabled",
      { timeout: 60_000 },
    );
    console.info("[live] enabled state survived the reload");

    const secondClickStart = performance.now();
    await page.getByRole("link", { name: "Open chats" }).click();
    await expectChatsSettled(page);
    console.info(
      `[live] Open chats after reload settled in ${elapsed(secondClickStart)}ms`,
    );
  } finally {
    await browser.close();
  }
});
