import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, expect, test, type Page } from "@playwright/test";

/**
 * Does the DM send path work at all on the deployed build?
 *
 * The Ring-driven gate leaves the sender's first message at "sending" forever.
 * This spec exercises the same `LinkService.sendDm` on the same origin through
 * the harness provisioning path instead of Ring, so a pass localises the defect
 * to Ring provisioning and a failure localises it to the send path itself.
 *
 *   RUN_PROD_DM_SEND=1 PUBKY_STAGING_INVITE_SCRIPT=<script> \
 *     npx playwright test e2e/dm-send-prod.spec.ts
 */

const execFileAsync = promisify(execFile);
const ORIGIN = process.env.SW_UPGRADE_ORIGIN?.trim() ?? "https://hypercolor.app";
const GENERATE = process.env.PUBKY_STAGING_INVITE_SCRIPT?.trim() ?? "";

type SignupResult = { pubky: string; receiverPath: string };
type SendResult = { body: string; deliveryState?: string; eventId?: string };

/**
 * The harness page installs these on `window`. Declared locally rather than on
 * the global `Window` so this spec does not clash with the app's own typing.
 */
type DmHarness = {
  runDmSignup: (token: string) => Promise<SignupResult>;
  runDmEnsure: (peer: string) => Promise<string>;
  runDmSend: (peer: string, body: string) => Promise<SendResult>;
  runDmSync: (peers: string[]) => Promise<{ body: string }[]>;
};

function harness(): DmHarness {
  return window as unknown as DmHarness;
}

async function mintToken(): Promise<string> {
  if (!GENERATE) throw new Error("set PUBKY_STAGING_INVITE_SCRIPT");
  const { stdout } = await execFileAsync("bash", [GENERATE], { timeout: 20_000 });
  const token = stdout.trim();
  if (!token) throw new Error("staging invite script returned an empty token");
  return token;
}

function watchFailures(page: Page, label: string): void {
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    console.info(`[dm ${label}] NON2XX ${status} ${response.request().method()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    console.info(
      `[dm ${label}] REQFAIL ${request.failure()?.errorText} ${request.method()} ${request.url()}`,
    );
  });
}

async function openHarness(page: Page, label: string): Promise<void> {
  watchFailures(page, label);
  await page.goto(`${ORIGIN}/e2e/dm-harness`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => typeof (window as unknown as { runDmSignup?: unknown }).runDmSignup === "function",
    undefined,
    {
      timeout: 60_000,
    },
  );
}

test("the deployed build can send a DM through the harness provisioning path", async () => {
  test.setTimeout(600_000);
  test.skip(
    process.env.RUN_PROD_DM_SEND !== "1",
    "Set RUN_PROD_DM_SEND=1 to run the production DM send probe.",
  );

  const browser = await chromium.launch();
  try {
    const pageA = await (await browser.newContext()).newPage();
    const pageB = await (await browser.newContext()).newPage();
    await openHarness(pageA, "A");
    await openHarness(pageB, "B");

    const [tokenA, tokenB] = await Promise.all([mintToken(), mintToken()]);
    const signupA = await pageA.evaluate((t) => harness().runDmSignup(t), tokenA);
    const signupB = await pageB.evaluate((t) => harness().runDmSignup(t), tokenB);
    console.info(`[dm] A=${signupA.pubky} B=${signupB.pubky}`);
    expect(signupA.pubky).not.toBe(signupB.pubky);

    // B must know A for its inbox sync to poll A at all.
    await pageB.evaluate((peer) => harness().runDmEnsure(peer), signupA.pubky);

    const sent = await pageA.evaluate(
      async ([peer, body]) => {
        try {
          return { ok: true as const, row: await harness().runDmSend(peer!, body!) };
        } catch (error) {
          return { ok: false as const, message: (error as Error).message };
        }
      },
      [signupB.pubky, "harness-hello-from-a"],
    );
    console.info(`[dm] send result ${JSON.stringify(sent)}`);
    expect(sent.ok, `sendDm threw: ${sent.ok ? "" : sent.message}`).toBe(true);

    const received = await pageB.evaluate(
      async (peer) => harness().runDmSync([peer]),
      signupA.pubky,
    );
    console.info(`[dm] B received ${JSON.stringify(received.map((row) => row.body))}`);
    expect(received.map((row) => row.body)).toContain("harness-hello-from-a");
  } finally {
    await browser.close();
  }
});
