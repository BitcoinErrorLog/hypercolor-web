import { chromium, expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stagingBaseUrl } from "./support/staging-base-url";

const execFileAsync = promisify(execFile);
const GENERATE =
  process.env.STAGING_INVITE_SCRIPT ??
  "/Users/johncarvalho/.cursor/skills/pubky-staging-invite/scripts/generate.sh";
const BASE_URL = stagingBaseUrl();

const PUBLIC_IDENTIFIER = "lno";
const PUBLIC_PAYLOAD =
  "lno1qgsqvgnwgcg35z6ee2m68z3gthgl96qfnu7hvasu7a3r5pk5lzrefzpd9kx7mmwxu025chv9dcu";
const PRIVATE_ENDPOINTS = {
  lno: "lno1pgx9getnwss8vetrw3hhygry59e5kxr3s8q5yvr9dcs8y6rvd5e5sgryv9e8g",
};

type SignupResult = { pubky: string; receiverPath: string };
type PaymentsPublicView = {
  endpoint: string | undefined;
  list: Record<string, string>;
  methods: string[];
  receiverPaths: string[];
};

declare global {
  interface Window {
    runDmSignup?: (token: string) => Promise<SignupResult>;
    runDmEnsure?: (peer: string) => Promise<string>;
    runPaymentsSetEndpoint?: (identifier: string, payload: string) => Promise<void>;
    runPaymentsRemoveEndpoint?: (identifier: string) => Promise<void>;
    runPaymentsReadPublic?: (
      payee: string,
      receiverPath: string,
      identifier: string,
    ) => Promise<PaymentsPublicView>;
    runPaymentsSendPrivateList?: (
      peer: string,
      endpoints: Record<string, string>,
    ) => Promise<void>;
    runPaymentsReceivePrivateList?: (
      peer: string,
    ) => Promise<Record<string, string>[]>;
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

async function resolveTokens(): Promise<{ a: string; b: string } | null> {
  const envA = process.env.STAGING_SIGNUP_TOKEN_A?.trim();
  const envB = process.env.STAGING_SIGNUP_TOKEN_B?.trim();
  if (envA && envB) return { a: envA, b: envB };
  if (process.env.RUN_STAGING_PAYMENTS !== "1") return null;
  const a = await mintToken();
  const b = await mintToken();
  return { a, b };
}

async function waitHarness(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Payments staging harness" })).toBeVisible();
  await page.waitForFunction(() => typeof window.runPaymentsReadPublic === "function");
}

async function signup(page: Page, token: string): Promise<SignupResult> {
  return page.evaluate(async (signupToken) => {
    const run = window.runDmSignup;
    if (!run) throw new Error("window.runDmSignup is not installed");
    return run(signupToken);
  }, token);
}

async function readPublic(
  page: Page,
  payee: string,
  receiverPath: string,
): Promise<PaymentsPublicView> {
  return page.evaluate(
    async (input) => {
      const run = window.runPaymentsReadPublic;
      if (!run) throw new Error("window.runPaymentsReadPublic is not installed");
      return run(input.payee, input.receiverPath, input.identifier);
    },
    { payee, receiverPath, identifier: PUBLIC_IDENTIFIER },
  );
}

async function waitForPublic(
  page: Page,
  payee: string,
  receiverPath: string,
  present: boolean,
): Promise<PaymentsPublicView> {
  const deadline = Date.now() + 90_000;
  let view: PaymentsPublicView | null = null;
  while (Date.now() < deadline) {
    view = await readPublic(page, payee, receiverPath);
    const hasEndpoint = view.endpoint === PUBLIC_PAYLOAD;
    const inList = view.list[PUBLIC_IDENTIFIER] === PUBLIC_PAYLOAD;
    const inMethods = view.methods.includes(PUBLIC_IDENTIFIER);
    if (present && hasEndpoint && inList && inMethods) return view;
    if (!present && view.endpoint === undefined && !inList && !inMethods) {
      return view;
    }
    await page.waitForTimeout(1500);
  }
  throw new Error(
    present
      ? "public payment endpoint did not become visible"
      : "public payment endpoint was still visible after removal",
  );
}

async function ensureReady(pageA: Page, pageB: Page, pubkyA: string, pubkyB: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  let statusA = "";
  let statusB = "";
  while (Date.now() < deadline) {
    statusA = await pageA.evaluate(async (peer) => {
      const run = window.runDmEnsure;
      if (!run) throw new Error("window.runDmEnsure is not installed");
      return run(peer);
    }, pubkyB);
    statusB = await pageB.evaluate(async (peer) => {
      const run = window.runDmEnsure;
      if (!run) throw new Error("window.runDmEnsure is not installed");
      return run(peer);
    }, pubkyA);
    if (statusA === "ready" && statusB === "ready") return;
    await pageA.waitForTimeout(1500);
  }
  throw new Error(`Encrypted Link not ready (A=${statusA}, B=${statusB})`);
}

test("staging public payment endpoint + private payment list", async () => {
  test.setTimeout(180_000);
  const tokens = await resolveTokens();
  test.skip(
    !tokens,
    [
      "Live staging payments proof skipped (no tokens).",
      "Mint two tokens (do not commit them) and rerun:",
      `  bash ${GENERATE}`,
      "  STAGING_SIGNUP_TOKEN_A=<a> STAGING_SIGNUP_TOKEN_B=<b> npm run proof:staging:payments",
      "Or: RUN_STAGING_PAYMENTS=1 npm run proof:staging:payments",
    ].join("\n"),
  );

  const browserA = await chromium.launch();
  const browserB = await chromium.launch();
  try {
    const pageA = await (await browserA.newContext()).newPage();
    const pageB = await (await browserB.newContext()).newPage();

    await pageA.goto(`${BASE_URL}/e2e/payments-harness`);
    await pageB.goto(`${BASE_URL}/e2e/payments-harness`);
    await waitHarness(pageA);
    await waitHarness(pageB);

    const signedA = await signup(pageA, tokens!.a);
    expect(signedA.pubky.length).toBe(52);

    await pageA.evaluate(
      async (input) => {
        const run = window.runPaymentsSetEndpoint;
        if (!run) throw new Error("window.runPaymentsSetEndpoint is not installed");
        return run(input.identifier, input.payload);
      },
      { identifier: PUBLIC_IDENTIFIER, payload: PUBLIC_PAYLOAD },
    );

    const published = await waitForPublic(pageB, signedA.pubky, signedA.receiverPath, true);
    expect(published.endpoint).toBe(PUBLIC_PAYLOAD);
    expect(published.list).toEqual({ [PUBLIC_IDENTIFIER]: PUBLIC_PAYLOAD });
    expect(published.methods).toContain(PUBLIC_IDENTIFIER);
    expect(published.receiverPaths).toContain(signedA.receiverPath);

    const signedB = await signup(pageB, tokens!.b);
    expect(signedB.pubky.length).toBe(52);
    expect(signedB.pubky).not.toBe(signedA.pubky);

    await ensureReady(pageA, pageB, signedA.pubky, signedB.pubky);

    await pageA.evaluate(
      async (input) => {
        const run = window.runPaymentsSendPrivateList;
        if (!run) throw new Error("window.runPaymentsSendPrivateList is not installed");
        return run(input.peer, input.endpoints);
      },
      { peer: signedB.pubky, endpoints: PRIVATE_ENDPOINTS },
    );

    const deadline = Date.now() + 90_000;
    let lists: Record<string, string>[] = [];
    while (Date.now() < deadline) {
      lists = await pageB.evaluate(async (peer) => {
        const run = window.runPaymentsReceivePrivateList;
        if (!run) throw new Error("window.runPaymentsReceivePrivateList is not installed");
        return run(peer);
      }, signedA.pubky);
      if (lists.some((list) => list.lno === PRIVATE_ENDPOINTS.lno)) break;
      await pageB.waitForTimeout(1500);
    }
    expect(lists).toContainEqual(PRIVATE_ENDPOINTS);

    await pageA.evaluate(async (identifier) => {
      const run = window.runPaymentsRemoveEndpoint;
      if (!run) throw new Error("window.runPaymentsRemoveEndpoint is not installed");
      return run(identifier);
    }, PUBLIC_IDENTIFIER);

    const gone = await waitForPublic(pageB, signedA.pubky, signedA.receiverPath, false);
    expect(gone.endpoint).toBeUndefined();
    expect(gone.list[PUBLIC_IDENTIFIER]).toBeUndefined();
    expect(gone.methods).not.toContain(PUBLIC_IDENTIFIER);
  } finally {
    await browserA.close();
    await browserB.close();
  }
});
