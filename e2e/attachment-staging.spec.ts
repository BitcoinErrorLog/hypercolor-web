import { chromium, expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GENERATE =
  "/Users/johncarvalho/.cursor/skills/pubky-staging-invite/scripts/generate.sh";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

async function mintToken(): Promise<string> {
  const { stdout } = await execFileAsync("bash", [GENERATE], {
    timeout: 20_000,
  });
  const token = stdout.trim();
  if (!token) throw new Error("staging invite script returned an empty token");
  return token;
}

async function resolveToken(): Promise<string | null> {
  const fromEnv = process.env.STAGING_SIGNUP_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.RUN_STAGING_ATTACH !== "1") return null;
  return mintToken();
}

async function waitHarness(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Attachment staging harness" }),
  ).toBeVisible();
  await page.waitForFunction(
    () => typeof window.runAttachmentSignupUpload === "function",
  );
}

test("staging attachment encrypt+PUT → public GET decrypt → DELETE", async () => {
  test.setTimeout(180_000);
  const token = await resolveToken();
  test.skip(
    !token,
    [
      "Live staging attachment proof skipped (no token).",
      "Mint a token (do not commit it) and rerun:",
      `  bash ${GENERATE}`,
      "  STAGING_SIGNUP_TOKEN=<token> npm run proof:staging:attach",
      "Or: RUN_STAGING_ATTACH=1 npm run proof:staging:attach",
    ].join("\n"),
  );

  const browserA = await chromium.launch();
  const browserB = await chromium.launch();
  try {
    const pageA = await (await browserA.newContext()).newPage();
    const pageB = await (await browserB.newContext()).newPage();

    await pageA.goto(`${BASE_URL}/e2e/attachment-roundtrip`);
    await pageB.goto(`${BASE_URL}/e2e/attachment-roundtrip`);
    await waitHarness(pageA);
    await waitHarness(pageB);

    const uploaded = await pageA.evaluate(async (signupToken) => {
      const run = window.runAttachmentSignupUpload;
      if (!run) throw new Error("window.runAttachmentSignupUpload is not installed");
      return run(signupToken);
    }, token as string);

    expect(uploaded.pubky.length).toBe(52);
    expect(uploaded.size).toBeGreaterThan(0);
    expect(uploaded.location.startsWith(`pubky://${uploaded.pubky}/pub/hypercolor.app/v1/attachments/`)).toBe(
      true,
    );

    const downloaded = await pageB.evaluate(
      async (input) => {
        const run = window.runAttachmentPublicDecrypt;
        if (!run) throw new Error("window.runAttachmentPublicDecrypt is not installed");
        return run(input);
      },
      {
        location: uploaded.location,
        key: uploaded.key,
        nonce: uploaded.nonce,
      },
    );
    expect(downloaded.bytesEqual).toBe(true);
    expect(downloaded.size).toBe(uploaded.size);

    const deleted = await pageA.evaluate(async (location) => {
      const run = window.runAttachmentDelete;
      if (!run) throw new Error("window.runAttachmentDelete is not installed");
      return run(location);
    }, uploaded.location);
    expect(deleted.deleteOk).toBe(true);
    expect(deleted.gone).toBe(true);

    const afterDelete = await pageB.evaluate(async (location) => {
      const run = window.runAttachmentPublicDecrypt;
      if (!run) throw new Error("window.runAttachmentPublicDecrypt is not installed");
      try {
        return await run({ location, key: "x", nonce: "y" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "decrypt failed";
        return { bytesEqual: false, size: 0, gone: /not found/i.test(message) };
      }
    }, uploaded.location);
    expect(afterDelete.gone).toBe(true);
  } finally {
    await browserA.close();
    await browserB.close();
  }
});
