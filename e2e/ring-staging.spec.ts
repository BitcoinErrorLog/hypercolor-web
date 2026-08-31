import { chromium, expect, test, type Page } from "@playwright/test";
import {
  createStagingIdentity,
  extractAuthUrl,
  type RingSimulatorHandle,
} from "./support/ring-simulator";

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  (process.env.RUN_STAGING_RING === "1"
    ? `http://localhost:${process.env.PLAYWRIGHT_RING_PORT ?? "3010"}`
    : "http://localhost:3000");

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
): Promise<void> {
  await page.goto(`${BASE_URL}/`);
  await waitForWelcomeReady(page);
  const connectUrl = await extractAuthUrl(page, "welcome");
  await identity.approvePaykitConnect(connectUrl);
  await expect(page.getByTestId("welcomeAdopt")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("welcomeAdopt")).toContainText(identity.pubky);
  await page.getByTestId("welcomeAdopt").getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/enable/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Enable encrypted messaging" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("enableMessagingOpenRing")).toBeVisible({ timeout: 30_000 });
  const authUrl = await extractAuthUrl(page, "enableMessaging");
  await identity.approvePubkyauth(authUrl);
  await expect(page.getByTestId("enableMessagingStatus")).toContainText(
    "Encrypted messaging enabled",
    { timeout: 60_000 },
  );
  await expect(page.getByText(identity.pubky)).toBeVisible();
}

async function openChats(page: Page): Promise<void> {
  // Client-side only: a full reload drops the in-memory Paykit session and
  // the chats CTA comes back. Stay on the same JS context after Enable.
  const open = page.getByRole("link", { name: "Open chats" });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  await expect(page).toHaveURL(/\/chats/, { timeout: 15_000 });
  await expect(page.getByTestId("chatsScreen")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("chatsEnableMessaging")).toHaveCount(0, { timeout: 15_000 });
}

async function startDm(page: Page, peerPubky: string): Promise<void> {
  await openChats(page);
  await page.getByTestId("chatsNewInput").fill(peerPubky);
  await page.getByTestId("chatsNew").click();
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
    await completeRingOnboarding(pageA, identityA);
    await startDm(pageA, identityB.pubky);
    const pageB = await (await browserB.newContext()).newPage();
    await completeRingOnboarding(pageB, identityB);
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
