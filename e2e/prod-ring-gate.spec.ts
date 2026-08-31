import { chromium, expect, test, type Page } from "@playwright/test";
import { createStagingIdentity, type RingSimulatorHandle } from "./support/ring-simulator";

/**
 * Production gate: Ring approval, Enable, Chats, and a first DM through the
 * explicit-accept gate, driven against the live deployment.
 *
 * The Ring simulator is the test driver only — a real staging identity that
 * performs the same sb2 handoff and pubkyauth approval Pubky Ring performs.
 * Every assertion below is on rendered text a visitor can see, never on test
 * ids, dataset attributes, or store internals.
 *
 *   RUN_PROD_RING_GATE=1 npx playwright test e2e/prod-ring-gate.spec.ts
 */

const BASE_URL = process.env.PROD_GATE_BASE_URL?.trim() ?? "https://hypercolor.app";

function elapsed(from: number): number {
  return Math.round(performance.now() - from);
}

function trace(label: string, message: string): void {
  console.info(`[gate ${label}] ${message}`);
}

type FailedRequest = { method: string; url: string; status: number | string };

function attachDiagnostics(page: Page, label: string): FailedRequest[] {
  const failures: FailedRequest[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") trace(label, `console-error ${msg.text()}`);
  });
  page.on("pageerror", (error) => trace(label, `pageerror ${error.message}`));
  page.on("response", (response) => {
    const status = response.status();
    if (status >= 200 && status < 300) return;
    if (status >= 300 && status < 400) return;
    const entry = { method: response.request().method(), url: response.url(), status };
    failures.push(entry);
    trace(label, `NON2XX ${entry.status} ${entry.method} ${entry.url}`);
  });
  page.on("requestfailed", (request) => {
    const entry = {
      method: request.method(),
      url: request.url(),
      status: request.failure()?.errorText ?? "failed",
    };
    failures.push(entry);
    trace(label, `REQFAIL ${entry.status} ${entry.method} ${entry.url}`);
  });
  return failures;
}

/**
 * Attach CDP so a failing request can be traced back to the code that issued
 * it. Playwright's own events do not carry the initiator stack.
 */
async function attachInitiatorTrace(page: Page, label: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const requests = new Map<string, { url: string; method: string; initiator: string }>();
  cdp.on("Network.requestWillBeSent", (event) => {
    const frames = event.initiator?.stack?.callFrames ?? [];
    const top = frames
      .slice(0, 4)
      .map((f) => `${f.functionName || "<anon>"}@${f.url.split("/").pop()}:${f.lineNumber}`)
      .join(" < ");
    requests.set(event.requestId, {
      url: event.request.url,
      method: event.request.method,
      initiator: `${event.initiator?.type ?? "?"} ${top}`,
    });
  });
  cdp.on("Network.responseReceived", (event) => {
    if (event.response.status < 400) return;
    trace(
      label,
      `INITIATOR ${event.response.status} ${event.response.url} :: ${requests.get(event.requestId)?.initiator ?? "unknown"}`,
    );
  });
  // The decisive signal for an aborted request: `canceled` marks a requester
  // -initiated cancel, `blockedReason` marks a policy block, and anything else
  // points at the transport.
  cdp.on("Network.loadingFailed", (event) => {
    const request = requests.get(event.requestId);
    trace(
      label,
      `LOADINGFAILED ${request?.method ?? "?"} ${request?.url ?? "?"} ` +
        `errorText=${event.errorText} canceled=${String(event.canceled)} ` +
        `blockedReason=${event.blockedReason ?? "none"} type=${event.type} ` +
        `corsError=${event.corsErrorStatus?.corsError ?? "none"} ` +
        `initiator=${request?.initiator ?? "unknown"}`,
    );
  });
}

/**
 * Read the Ring URL from the copy the page actually shows the visitor, so the
 * driver depends on nothing the product wouldn't render for a human.
 */
async function visibleRingUrl(page: Page, scheme: "pubkyring" | "pubkyauth"): Promise<string> {
  const pattern = scheme === "pubkyring" ? /pubkyring:/i : /pubkyauth:/i;
  const line = page.locator("p.font-mono").filter({ hasText: pattern }).first();
  await expect(line).toBeVisible({ timeout: 60_000 });
  const text = (await line.textContent())?.trim() ?? "";
  if (!text.toLowerCase().startsWith(`${scheme}:`)) {
    throw new Error(`expected a ${scheme} URL on screen, saw ${text.slice(0, 40)}`);
  }
  return text;
}

async function completeRingOnboarding(
  page: Page,
  identity: RingSimulatorHandle,
  label: string,
): Promise<void> {
  const start = performance.now();
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Hypercolor", level: 1 })).toBeVisible({
    timeout: 60_000,
  });

  const connectUrl = await visibleRingUrl(page, "pubkyring");
  trace(label, `approving paykit-connect after ${elapsed(start)}ms`);
  await identity.approvePaykitConnect(connectUrl);

  // Ring answered: the app offers to continue as the approved identity.
  await expect(page.getByText(`Continue as`)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(identity.pubky, { exact: false }).first()).toBeVisible();
  trace(label, `adoption offered after ${elapsed(start)}ms`);
  await page.getByRole("button", { name: "Continue" }).click({ noWaitAfter: true });

  await expect(
    page.getByRole("heading", { name: "Enable encrypted messaging", level: 1 }),
  ).toBeVisible({ timeout: 60_000 });
  expect(new URL(page.url()).pathname).toBe("/enable");
  trace(label, `enable screen after ${elapsed(start)}ms`);

  const authUrl = await visibleRingUrl(page, "pubkyauth");
  const approveStart = performance.now();
  await identity.approvePubkyauth(authUrl);
  await expect(page.getByText("Encrypted messaging enabled")).toBeVisible({
    timeout: 120_000,
  });
  trace(
    label,
    `messaging enabled ${elapsed(approveStart)}ms after approval (${elapsed(start)}ms total)`,
  );
}

async function openChatsFromEnable(page: Page, label: string): Promise<void> {
  const openChats = page.getByRole("link", { name: "Open chats" });
  await expect(openChats).toBeVisible({ timeout: 30_000 });
  const clickStart = performance.now();
  await openChats.click();
  await expect(page.getByRole("heading", { name: "Chats", level: 1 })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByPlaceholder("Paste a pubky to start a chat")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/chats");
  // Messaging is enabled, so the chats screen must not still be asking for it.
  await expect(
    page.getByText("Encrypted chats need a Ring-approved Paykit session on this device."),
  ).toHaveCount(0);
  trace(label, `Open chats settled in ${elapsed(clickStart)}ms`);
}

async function startThread(page: Page, peerPubky: string, label: string): Promise<void> {
  await page.getByPlaceholder("Paste a pubky to start a chat").fill(peerPubky);
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByRole("heading", { name: peerPubky, level: 2 })).toBeVisible({
    timeout: 60_000,
  });
  trace(label, `thread open with ${peerPubky.slice(0, 8)}…`);
}

/**
 * Send until the sender's own transcript shows the message. A first DM races
 * receiver-marker discovery on the homeserver, so a send can legitimately fail
 * once before the peer's marker resolves.
 */
async function sendMessage(page: Page, body: string, label: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastError = "";
  for (let attempt = 1; Date.now() < deadline; attempt += 1) {
    await page.getByPlaceholder("Message").fill(body);
    // Bounded: a stuck send leaves the composer disabled, and an unbounded
    // click would wait on it forever instead of reporting.
    const clicked = await page
      .getByRole("button", { name: "Send", exact: true })
      .click({ timeout: 10_000 })
      .then(
        () => true,
        (error: Error) => {
          trace(label, `send button not actionable: ${error.message.split("\n")[0]}`);
          return false;
        },
      );
    if (!clicked) {
      const labels = await page.getByText(/·\s*\w+$/).allTextContents();
      throw new Error(
        `composer stayed disabled after a send; delivery labels ${JSON.stringify(labels)}`,
      );
    }
    // The body renders immediately from the optimistic local row, so it proves
    // nothing. The visible delivery label is the only signal that the payload
    // actually left this device.
    const landed = await page
      .getByText(/·\s*(sent|delivered|read)\b/)
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(
        () => true,
        () => false,
      );
    if (landed) {
      trace(label, `sent "${body}" on attempt ${attempt}`);
      return;
    }
    const labels = await page.getByText(/·\s*\w+$/).allTextContents();
    lastError =
      (await page.locator("p.text-red-400").first().textContent().catch(() => null)) ??
      `delivery label never reached sent (saw ${JSON.stringify(labels)})`;
    trace(label, `send attempt ${attempt} failed: ${lastError}`);
    await page.waitForTimeout(3_000);
  }
  throw new Error(`send never landed: ${lastError}`);
}

/**
 * The receiving side must accept through the UI. Held requests only surface
 * after an inbox sync, and `collectInboxCandidates` polls only peers already in
 * the recipient's contacts or links — so the recipient has to know the sender
 * exists before the sender's first message is discoverable. Opening a thread
 * with the sender is how a visitor does that, and it does not skip the gate:
 * with no routed messages yet, the inbound is still classified as a request.
 */
async function acceptRequestFor(page: Page, peerPubky: string, label: string): Promise<void> {
  const waitStart = performance.now();
  const deadline = Date.now() + 180_000;
  for (;;) {
    await page.goto(`${BASE_URL}/chats`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Chats", level: 1 })).toBeVisible({
      timeout: 60_000,
    });
    const pending = await page
      .getByRole("link", { name: /^Requests \(\d+\)$/ })
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(
        () => true,
        () => false,
      );
    if (pending) break;
    if (Date.now() > deadline) {
      throw new Error("no pending message request ever appeared on the chats screen");
    }
    await page.waitForTimeout(5_000);
  }
  const counter = await page
    .getByRole("link", { name: /^Requests \(\d+\)$/ })
    .first()
    .textContent();
  trace(label, `chats screen shows "${counter}" after ${elapsed(waitStart)}ms`);

  await page.getByRole("link", { name: /^Requests \(\d+\)$/ }).first().click();
  await expect(page.getByRole("heading", { name: "Message requests", level: 1 })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(peerPubky, { exact: false }).first()).toBeVisible();
  trace(label, "message request listed with the sender's pubky");

  await page.getByRole("button", { name: "Accept" }).first().click();
  await expect(page.getByRole("heading", { name: peerPubky, level: 2 })).toBeVisible({
    timeout: 90_000,
  });
  trace(label, `accepted; thread opened in ${elapsed(waitStart)}ms`);
}

async function expectMessageVisible(page: Page, body: string, label: string): Promise<void> {
  await expect(page.getByText(body, { exact: false }).first()).toBeVisible({
    timeout: 120_000,
  });
  trace(label, `sees "${body}"`);
}

test("production: Ring approval, Enable, Chats, and a first DM through explicit accept", async () => {
  test.setTimeout(900_000);
  test.skip(
    process.env.RUN_PROD_RING_GATE !== "1",
    "Set RUN_PROD_RING_GATE=1 to run the production Ring gate.",
  );

  const identityA = await createStagingIdentity();
  const identityB = await createStagingIdentity();
  expect(identityA.pubky).not.toBe(identityB.pubky);
  trace("setup", `A=${identityA.pubky} B=${identityB.pubky}`);

  const browserA = await chromium.launch();
  const browserB = await chromium.launch();
  let summarize: () => void = () => {};
  try {
    const pageA = await (await browserA.newContext()).newPage();
    const pageB = await (await browserB.newContext()).newPage();
    const failuresA = attachDiagnostics(pageA, "A");
    const failuresB = attachDiagnostics(pageB, "B");
    await attachInitiatorTrace(pageA, "A");
    await attachInitiatorTrace(pageB, "B");
    summarize = () => {
      for (const [label, failures] of [
        ["A", failuresA],
        ["B", failuresB],
      ] as const) {
        const counts = new Map<string, number>();
        for (const failure of failures) {
          const key = `${failure.status} ${failure.method} ${failure.url}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        trace(label, `--- non-2xx summary (${failures.length} total) ---`);
        for (const [key, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
          trace(label, `x${count} ${key}`);
        }
      }
    };

    // Leg 2a: Ring -> Enable -> Chats for both identities, through the real UI.
    await completeRingOnboarding(pageA, identityA, "A");
    await openChatsFromEnable(pageA, "A");
    await pageA.screenshot({ path: "/tmp/hc-gate/leg2-a-chats.png", fullPage: true });

    await completeRingOnboarding(pageB, identityB, "B");
    await openChatsFromEnable(pageB, "B");
    await pageB.screenshot({ path: "/tmp/hc-gate/leg2-b-chats.png", fullPage: true });

    // Leg 2b: first DM A -> B, held as a request until B accepts on screen.
    await startThread(pageA, identityB.pubky, "A");
    await sendMessage(pageA, "gate-hello-from-a", "A");
    await pageA.screenshot({ path: "/tmp/hc-gate/leg2-a-sent.png", fullPage: true });

    await startThread(pageB, identityA.pubky, "B");
    await acceptRequestFor(pageB, identityA.pubky, "B");
    await expectMessageVisible(pageB, "gate-hello-from-a", "B");
    await pageB.screenshot({ path: "/tmp/hc-gate/leg2-b-received.png", fullPage: true });

    // Reverse direction. B already accepted, so no second gate is expected.
    await sendMessage(pageB, "gate-hello-from-b", "B");
    await expectMessageVisible(pageA, "gate-hello-from-b", "A");
    await pageA.screenshot({ path: "/tmp/hc-gate/leg2-a-received.png", fullPage: true });
  } finally {
    summarize();
    trace("setup", `A=${identityA.pubky} B=${identityB.pubky}`);
    identityA.dispose();
    identityB.dispose();
    await browserA.close();
    await browserB.close();
  }
});
