import { chromium, expect, test, type Page } from "@playwright/test";
import {
  createStagingIdentity,
  extractAuthUrl,
  type RingSimulatorHandle,
} from "./support/ring-simulator";
import { stagingBaseUrl } from "./support/staging-base-url";

const BASE_URL = stagingBaseUrl();

function describeAuthUrl(url: string): string {
  try {
    if (url.startsWith("pubkyring:") || url.includes("paykit-connect")) {
      const parsed = new URL(url.replace(/^pubkyring:/i, "https:"));
      const callback = parsed.searchParams.get("callback") ?? "";
      const ch = callback ? (new URL(callback).searchParams.get("ch") ?? "") : "";
      return `paykit-connect ch=${ch}`;
    }
    if (url.startsWith("pubkyauth:")) {
      const parsed = new URL(url.replace(/^pubkyauth:/i, "https:"));
      const relay = parsed.searchParams.get("relay") ?? "";
      const secret = parsed.searchParams.get("secret") ?? "";
      const caps = parsed.searchParams.get("caps") ?? "";
      return `pubkyauth relay=${relay} caps=${caps} secretLen=${secret.length}`;
    }
  } catch (error) {
    return `unparseable: ${error instanceof Error ? error.message : "error"}`;
  }
  return `other ${url.slice(0, 48)}`;
}

function attachRelayTrace(page: Page, label: string): string[] {
  const hits: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("httprelay")) return;
    const line = `${req.method()} ${url}`;
    hits.push(line);
    console.info(`[ring-trace ${label}] ${line}`);
  });
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("ring-trace") || text.includes("hypercolor enable") || msg.type() === "error") {
      console.info(`[ring-trace ${label} console:${msg.type()}] ${text}`);
    }
  });
  page.on("pageerror", (error) => {
    console.info(`[ring-trace ${label} pageerror] ${error.message}`);
  });
  return hits;
}

async function extractTracedAuthUrl(page: Page, testIdPrefix: string): Promise<string> {
  const url = await extractAuthUrl(page, testIdPrefix);
  console.info(`[ring-trace extract ${testIdPrefix}] ${describeAuthUrl(url)}`);
  return url;
}

async function waitForWelcomeReady(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Hypercolor" })).toBeVisible({
    timeout: 30_000,
  });
  const qr = page.getByTestId("welcomeQr");
  const takeover = page.getByRole("status").getByRole("button", { name: "Take over" });
  await expect(qr.or(takeover)).toBeVisible({ timeout: 30_000 });
  // A full reload restarts paykit-connect TTL and can hang Next's `load`
  // event. Take over in-place only when the QR never appeared.
  if ((await qr.count()) === 0 && (await takeover.isVisible())) {
    await takeover.click();
  }
  await expect(qr).toBeVisible({ timeout: 30_000 });
}

async function completeRingOnboarding(
  page: Page,
  identity: RingSimulatorHandle,
  label: string,
): Promise<void> {
  const relayHits = attachRelayTrace(page, label);
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await waitForWelcomeReady(page);
  const connectUrl = await extractTracedAuthUrl(page, "welcome");
  console.info(`[ring-trace ${label}] approving ${describeAuthUrl(connectUrl)}`);
  console.info(`[ring-trace ${label}] GETs before paykit POST: ${relayHits.join(" | ") || "(none)"}`);
  await identity.approvePaykitConnect(connectUrl);
  await expect(page.getByTestId("welcomeAdopt")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("welcomeAdopt")).toContainText(identity.pubky);
  await page
    .getByTestId("welcomeAdopt")
    .getByRole("button", { name: "Continue" })
    .click({ noWaitAfter: true });
  await expect(page).toHaveURL(/\/enable/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Enable encrypted messaging" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("enableMessagingOpenRing")).toBeVisible({ timeout: 30_000 });
  const authUrl = await extractTracedAuthUrl(page, "enableMessaging");
  console.info(`[ring-trace ${label}] approving ${describeAuthUrl(authUrl)}`);
  console.info(`[ring-trace ${label}] GETs before pubkyauth: ${relayHits.join(" | ") || "(none)"}`);
  await identity.approvePubkyauth(authUrl);
  const status = page.getByTestId("enableMessagingStatus");
  const snap = async (tag: string) => {
    const statusCount = await status.count();
    const statusTexts = await status.allTextContents();
    const storeKinds = await Promise.all(
      Array.from({ length: statusCount }, (_, i) => status.nth(i).getAttribute("data-hc-store-kind")),
    );
    const openChatsCount = await page.getByTestId("enableOpenChats").count();
    console.info(`[ring-trace ${label} ${tag}]`, {
      statusCount,
      statusTexts,
      storeKinds,
      openChatsCount,
    });
    return { statusCount, statusTexts, storeKinds, openChatsCount };
  };
  await snap("after-approve");
  try {
    await expect(status.filter({ hasText: "Encrypted messaging enabled" })).toBeVisible({
      timeout: 60_000,
    });
  } catch (error) {
    const html = page.locator("html");
    const failSnap = await snap("enable-fail");
    const errorText = await page
      .locator("p.text-red-400")
      .textContent({ timeout: 2_000 })
      .catch(() => null);
    const dataset = {
      hcRestore: await html.getAttribute("data-hc-restore", { timeout: 2_000 }).catch(() => null),
      hcEnable: await html.getAttribute("data-hc-enable", { timeout: 2_000 }).catch(() => null),
      hcNote: await html.getAttribute("data-hc-note", { timeout: 2_000 }).catch(() => null),
      hcIdentity: await html.getAttribute("data-hc-identity", { timeout: 2_000 }).catch(() => null),
    };
    console.info(`[ring-trace ${label} enable-fail]`, {
      errorText,
      statusCount: failSnap.statusCount,
      statusTexts: failSnap.statusTexts,
      storeKinds: failSnap.storeKinds,
      openChatsCount: failSnap.openChatsCount,
      dataset,
    });
    throw error;
  }
  await expect(page.getByText(identity.pubky)).toBeVisible();
}

async function openChats(page: Page): Promise<void> {
  const open = page.getByTestId("enableOpenChats");
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click({ noWaitAfter: true, timeout: 15_000 });
  await expect(page).toHaveURL(/\/chats/, { timeout: 15_000 });
  const chats = page.getByTestId("chatsScreen");
  try {
    await expect(chats).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    const status = page.getByTestId("enableMessagingStatus");
    const statusCount = await status.count();
    const statusTexts = await status.allTextContents();
    const storeKinds = await Promise.all(
      Array.from({ length: statusCount }, (_, i) =>
        status.nth(i).getAttribute("data-hc-store-kind"),
      ),
    );
    const chatsCount = await chats.count();
    const chatsHidden = await Promise.all(
      Array.from({ length: chatsCount }, (_, i) => chats.nth(i).getAttribute("hidden")),
    );
    const ancestorHiddenCount =
      chatsCount > 0
        ? await chats.first().locator("xpath=ancestor-or-self::*[@hidden]").count()
        : 0;
    console.info("[ring-trace chatsScreen-fail]", {
      url: page.url(),
      statusCount,
      statusTexts,
      storeKinds,
      openChatsCount: await page.getByTestId("enableOpenChats").count(),
      chatsCount,
      chatsHidden,
      ancestorHiddenCount,
    });
    throw error;
  }
  await expect(page.getByTestId("chatsEnableMessaging")).toHaveCount(0, { timeout: 15_000 });
}

async function startDm(page: Page, peerPubky: string): Promise<void> {
  await openChats(page);
  await page.getByTestId("chatsNewInput").fill(peerPubky);
  await page.getByTestId("chatsNew").click({ noWaitAfter: true });
  await expect(page.getByTestId("threadScreen")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("threadPeer")).toHaveText(peerPubky);
}

async function sendAndSee(
  from: Page,
  to: Page,
  body: string,
): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastError = "";
  while (Date.now() < deadline) {
    await from.getByTestId("threadDraft").fill(body);
    await from.getByTestId("threadSend").click();
    try {
      await expect(to.getByTestId("dmMessage").filter({ hasText: body })).toBeVisible({
        timeout: 8_000,
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "message not visible";
      const sendError = await from.locator("p.text-red-400").textContent().catch(() => null);
      if (sendError) lastError = sendError;
      await from.waitForTimeout(1_500);
    }
  }
  throw new Error(`Encrypted Link message did not arrive: ${lastError}`);
}

test("Ring simulator completes Welcome + Enable and a staging A↔B Encrypted Link", async () => {
  test.setTimeout(360_000);
  test.skip(
    process.env.RUN_STAGING_RING !== "1" && !process.env.PLAYWRIGHT_BASE_URL,
    "Set RUN_STAGING_RING=1 (or PLAYWRIGHT_BASE_URL) to run the live Ring proof.",
  );

  const identityA = await createStagingIdentity();
  const identityB = await createStagingIdentity();
  expect(identityA.pubky).not.toBe(identityB.pubky);
  expect(identityA.pubky).toHaveLength(52);
  expect(identityB.pubky).toHaveLength(52);

  const browserA = await chromium.launch();
  const browserB = await chromium.launch();
  try {
    const pageA = await (await browserA.newContext()).newPage();
    pageA.setDefaultNavigationTimeout(10_000);
    await completeRingOnboarding(pageA, identityA, "A");
    await startDm(pageA, identityB.pubky);
    const pageB = await (await browserB.newContext()).newPage();
    pageB.setDefaultNavigationTimeout(10_000);
    await completeRingOnboarding(pageB, identityB, "B");
    await startDm(pageB, identityA.pubky);

    await sendAndSee(pageA, pageB, "ring-hello-from-a");
    await sendAndSee(pageB, pageA, "ring-hello-from-b");
  } finally {
    identityA.dispose();
    identityB.dispose();
    await browserA.close();
    await browserB.close();
  }
});
