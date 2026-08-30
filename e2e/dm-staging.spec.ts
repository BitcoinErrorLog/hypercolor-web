import { chromium, expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GENERATE =
  "/Users/johncarvalho/.cursor/skills/pubky-staging-invite/scripts/generate.sh";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

type SignupResult = { pubky: string; receiverPath: string };

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
  if (process.env.RUN_STAGING_DM !== "1") return null;
  const a = await mintToken();
  const b = await mintToken();
  return { a, b };
}

async function signup(page: Page, token: string): Promise<SignupResult> {
  return page.evaluate(async (signupToken) => {
    const run = (
      window as unknown as {
        runDmSignup?: (value: string) => Promise<SignupResult>;
      }
    ).runDmSignup;
    if (!run) throw new Error("window.runDmSignup is not installed");
    return run(signupToken);
  }, token);
}

test("staging A↔B Encrypted Link handshake + bidirectional chat.message.v0", async () => {
  test.setTimeout(180_000);
  const tokens = await resolveTokens();
  test.skip(
    !tokens,
    [
      "Live staging DM proof skipped (no tokens).",
      "Mint two tokens (do not commit them) and rerun:",
      `  bash ${GENERATE}`,
      "  STAGING_SIGNUP_TOKEN_A=<a> STAGING_SIGNUP_TOKEN_B=<b> npm run proof:staging",
      "Or: RUN_STAGING_DM=1 npm run proof:staging",
    ].join("\n"),
  );

  // Separate browser processes so each peer has its own Web Locks profile.
  // Two contexts in one browser share navigator.locks and only one can be writer.
  const browserA = await chromium.launch();
  const browserB = await chromium.launch();
  try {
    const pageA = await (await browserA.newContext()).newPage();
    const pageB = await (await browserB.newContext()).newPage();

    await pageA.goto(`${BASE_URL}/e2e/dm-harness`);
    await pageB.goto(`${BASE_URL}/e2e/dm-harness`);
    await expect(pageA.getByRole("heading", { name: "DM staging harness" })).toBeVisible();
    await expect(pageB.getByRole("heading", { name: "DM staging harness" })).toBeVisible();
    await pageA.waitForFunction(() => typeof window.runDmSignup === "function");
    await pageB.waitForFunction(() => typeof window.runDmSignup === "function");

    const signedA = await signup(pageA, tokens!.a);
    const signedB = await signup(pageB, tokens!.b);
    expect(signedA.pubky.length).toBe(52);
    expect(signedB.pubky.length).toBe(52);
    expect(signedA.pubky).not.toBe(signedB.pubky);

    const deadline = Date.now() + 90_000;
    let statusA = "";
    let statusB = "";
    while (Date.now() < deadline) {
      statusA = await pageA.evaluate(
        async (peer) => window.runDmEnsure!(peer),
        signedB.pubky,
      );
      statusB = await pageB.evaluate(
        async (peer) => window.runDmEnsure!(peer),
        signedA.pubky,
      );
      if (statusA === "ready" && statusB === "ready") break;
      await pageA.waitForTimeout(1500);
    }
    expect(statusA, "A did not reach a ready Encrypted Link").toBe("ready");
    expect(statusB, "B did not reach a ready Encrypted Link").toBe("ready");

    await pageA.evaluate(
      async ({ peer, body }) => window.runDmSend!(peer, body),
      { peer: signedB.pubky, body: "hello-from-a" },
    );
    const fromA = await pageB.evaluate(
      async (peer) => {
        const rows = await window.runDmSync!([peer]);
        return rows.map((row) => row.body);
      },
      signedA.pubky,
    );
    expect(fromA).toContain("hello-from-a");

    await pageB.evaluate(
      async ({ peer, body }) => window.runDmSend!(peer, body),
      { peer: signedA.pubky, body: "hello-from-b" },
    );
    const fromB = await pageA.evaluate(
      async (peer) => {
        const rows = await window.runDmSync!([peer]);
        return rows.map((row) => row.body);
      },
      signedB.pubky,
    );
    expect(fromB).toContain("hello-from-b");
  } finally {
    await browserA.close();
    await browserB.close();
  }
});
