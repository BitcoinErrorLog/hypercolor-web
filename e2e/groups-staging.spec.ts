import { chromium, expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GENERATE =
  process.env.STAGING_INVITE_SCRIPT ??
  "/Users/johncarvalho/.cursor/skills/pubky-staging-invite/scripts/generate.sh";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

type SignupResult = { pubky: string; receiverPath: string };
type GroupCreateResult = { channelId: string; name: string; memberCount: number };
type GroupMessageView = {
  channelId: string;
  eventId: string;
  senderPubky: string;
  body: string;
  kind: string;
  deliveryState: string;
};
type GroupStateView = {
  channelId: string;
  name: string;
  createdBy: string;
  members: { pubky: string; role: string; status: string }[];
  messages: GroupMessageView[];
};

declare global {
  interface Window {
    runDmSignup?: (token: string) => Promise<SignupResult>;
    runDmEnsure?: (peer: string) => Promise<string>;
    runGroupCreate?: (name: string, members: string[]) => Promise<GroupCreateResult>;
    runGroupSend?: (channelId: string, body: string) => Promise<GroupMessageView>;
    runGroupSync?: (
      peers: string[],
    ) => Promise<{ channels: { channelId: string; name: string }[]; messages: GroupMessageView[] }>;
    runGroupGet?: (channelId: string) => Promise<GroupStateView | null>;
  }
}

test.use({ trace: "off", video: "off" });

async function mintToken(): Promise<string> {
  const { stdout } = await execFileAsync("bash", [GENERATE], {
    timeout: 20_000,
  });
  const token = stdout.trim();
  if (!token) throw new Error("staging invite script returned an empty token");
  return token;
}

async function resolveTokens(): Promise<{ a: string; b: string; c: string } | null> {
  const envA = process.env.STAGING_SIGNUP_TOKEN_A?.trim();
  const envB = process.env.STAGING_SIGNUP_TOKEN_B?.trim();
  const envC = process.env.STAGING_SIGNUP_TOKEN_C?.trim();
  if (envA && envB && envC) return { a: envA, b: envB, c: envC };
  if (process.env.RUN_STAGING_GROUPS !== "1") return null;
  const a = await mintToken();
  const b = await mintToken();
  const c = await mintToken();
  return { a, b, c };
}

async function waitHarness(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Groups staging harness" })).toBeVisible();
  await page.waitForFunction(() => typeof window.runGroupCreate === "function");
}

async function signup(page: Page, token: string): Promise<SignupResult> {
  return page.evaluate(async (signupToken) => {
    const run = window.runDmSignup;
    if (!run) throw new Error("window.runDmSignup is not installed");
    return run(signupToken);
  }, token);
}

async function ensureReady(pageA: Page, pageB: Page, pubkyA: string, pubkyB: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  let statusA = "";
  let statusB = "";
  while (Date.now() < deadline) {
    statusA = await pageA.evaluate(async (peer) => window.runDmEnsure!(peer), pubkyB);
    statusB = await pageB.evaluate(async (peer) => window.runDmEnsure!(peer), pubkyA);
    if (statusA === "ready" && statusB === "ready") return;
    await pageA.waitForTimeout(1500);
  }
  expect(statusA, "link did not reach ready").toBe("ready");
  expect(statusB, "link did not reach ready").toBe("ready");
}

async function pollGroupGet(
  page: Page,
  channelId: string,
  peers: string[],
  predicate: (state: GroupStateView) => boolean,
  label: string,
): Promise<GroupStateView> {
  const deadline = Date.now() + 90_000;
  let last: GroupStateView | null = null;
  while (Date.now() < deadline) {
    await page.evaluate(async (syncPeers) => window.runGroupSync!(syncPeers), peers);
    last = await page.evaluate(async (id) => window.runGroupGet!(id), channelId);
    if (last && predicate(last)) return last;
    await page.waitForTimeout(1500);
  }
  throw new Error(`${label} timed out`);
}

test("staging A-B-C private group fan-out over Encrypted Links", async () => {
  test.setTimeout(240_000);
  const tokens = await resolveTokens();
  test.skip(
    !tokens,
    [
      "Live staging groups proof skipped (no tokens).",
      "Mint three tokens (do not commit them) and rerun:",
      `  bash ${GENERATE}`,
      "  STAGING_SIGNUP_TOKEN_A=<a> STAGING_SIGNUP_TOKEN_B=<b> STAGING_SIGNUP_TOKEN_C=<c> npm run proof:staging:groups",
      "Or: RUN_STAGING_GROUPS=1 npm run proof:staging:groups",
    ].join("\n"),
  );

  const browserA = await chromium.launch();
  const browserB = await chromium.launch();
  const browserC = await chromium.launch();
  try {
    const pageA = await (await browserA.newContext()).newPage();
    const pageB = await (await browserB.newContext()).newPage();
    const pageC = await (await browserC.newContext()).newPage();

    await pageA.goto(`${BASE_URL}/e2e/groups-harness`);
    await pageB.goto(`${BASE_URL}/e2e/groups-harness`);
    await pageC.goto(`${BASE_URL}/e2e/groups-harness`);
    await waitHarness(pageA);
    await waitHarness(pageB);
    await waitHarness(pageC);

    const signedA = await signup(pageA, tokens!.a);
    const signedB = await signup(pageB, tokens!.b);
    const signedC = await signup(pageC, tokens!.c);
    expect(signedA.pubky.length).toBe(52);
    expect(signedB.pubky.length).toBe(52);
    expect(signedC.pubky.length).toBe(52);
    expect(new Set([signedA.pubky, signedB.pubky, signedC.pubky]).size).toBe(3);

    await ensureReady(pageA, pageB, signedA.pubky, signedB.pubky);
    await ensureReady(pageA, pageC, signedA.pubky, signedC.pubky);

    const created: GroupCreateResult = await pageA.evaluate(
      async ({ name, members }) => window.runGroupCreate!(name, members),
      { name: "staging-group", members: [signedB.pubky, signedC.pubky] },
    );
    expect(created.channelId.startsWith(`${signedA.pubky}:`)).toBe(true);
    expect(created.memberCount).toBe(3);

    const onB = await pollGroupGet(
      pageB,
      created.channelId,
      [signedA.pubky],
      (state) =>
        state.channelId === created.channelId &&
        state.members.some((m) => m.pubky === signedB.pubky && m.status === "active"),
      "B membership",
    );
    const onC = await pollGroupGet(
      pageC,
      created.channelId,
      [signedA.pubky],
      (state) =>
        state.channelId === created.channelId &&
        state.members.some((m) => m.pubky === signedC.pubky && m.status === "active"),
      "C membership",
    );
    expect(onB.createdBy).toBe(signedA.pubky);
    expect(onC.createdBy).toBe(signedA.pubky);

    const sentA: GroupMessageView = await pageA.evaluate(
      async ({ channelId, body }) => window.runGroupSend!(channelId, body),
      { channelId: created.channelId, body: "hello-group-from-a" },
    );
    expect(sentA.channelId).toBe(created.channelId);
    expect(sentA.kind).toBe("chat.group.message.v0");
    expect(sentA.deliveryState).toBe("sent");

    const bGot = await pollGroupGet(
      pageB,
      created.channelId,
      [signedA.pubky],
      (state) =>
        state.messages.some(
          (row) =>
            row.eventId === sentA.eventId &&
            row.channelId === created.channelId &&
            row.body === "hello-group-from-a" &&
            row.deliveryState === "delivered",
        ),
      "B group message",
    );
    const cGot = await pollGroupGet(
      pageC,
      created.channelId,
      [signedA.pubky],
      (state) =>
        state.messages.some(
          (row) =>
            row.eventId === sentA.eventId &&
            row.channelId === created.channelId &&
            row.body === "hello-group-from-a" &&
            row.deliveryState === "delivered",
        ),
      "C group message",
    );
    expect(bGot.messages.find((row) => row.eventId === sentA.eventId)?.channelId).toBe(
      created.channelId,
    );
    expect(cGot.messages.find((row) => row.eventId === sentA.eventId)?.channelId).toBe(
      created.channelId,
    );

    const sentB: GroupMessageView = await pageB.evaluate(
      async ({ channelId, body }) => window.runGroupSend!(channelId, body),
      { channelId: created.channelId, body: "hello-group-from-b" },
    );
    expect(sentB.channelId).toBe(created.channelId);
    expect(sentB.deliveryState).toBe("sent");

    const aGot = await pollGroupGet(
      pageA,
      created.channelId,
      [signedB.pubky],
      (state) =>
        state.messages.some(
          (row) =>
            row.eventId === sentB.eventId &&
            row.channelId === created.channelId &&
            row.body === "hello-group-from-b" &&
            row.senderPubky === signedB.pubky &&
            row.deliveryState === "delivered",
        ),
      "A group reply",
    );
    expect(aGot.messages.find((row) => row.eventId === sentA.eventId)?.deliveryState).toBe("sent");
    expect(aGot.messages.find((row) => row.eventId === sentB.eventId)?.deliveryState).toBe(
      "delivered",
    );
  } finally {
    await browserA.close();
    await browserB.close();
    await browserC.close();
  }
});
