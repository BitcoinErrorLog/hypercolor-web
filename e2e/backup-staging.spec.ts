import { chromium, expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GENERATE =
  process.env.STAGING_INVITE_SCRIPT ??
  "/Users/johncarvalho/.cursor/skills/pubky-staging-invite/scripts/generate.sh";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Secrets travel as evaluate args; never write them into Playwright traces.
test.use({ trace: "off", video: "off" });

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
  if (process.env.RUN_STAGING_BACKUP !== "1") return null;
  return mintToken();
}

async function waitHarness(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Backup staging harness" })).toBeVisible();
  await page.waitForFunction(() => typeof window.runBackupSignupExport === "function");
}

test("staging backup export → fresh-context restore", async () => {
  test.setTimeout(180_000);
  const token = await resolveToken();
  test.skip(
    !token,
    [
      "Live staging backup proof skipped (no token).",
      "Mint a token (do not commit it) and rerun:",
      `  bash ${GENERATE}`,
      "  STAGING_SIGNUP_TOKEN=<token> npm run proof:staging:backup",
      "Or: RUN_STAGING_BACKUP=1 npm run proof:staging:backup",
    ].join("\n"),
  );

  const browserA = await chromium.launch();
  const browserB = await chromium.launch();
  try {
    const pageA = await (await browserA.newContext()).newPage();
    const pageB = await (await browserB.newContext()).newPage();

    await pageA.goto(`${BASE_URL}/e2e/backup-harness`);
    await waitHarness(pageA);

    const exported = await pageA.evaluate(async (signupToken) => {
      const run = window.runBackupSignupExport;
      if (!run) throw new Error("window.runBackupSignupExport is not installed");
      return run(signupToken);
    }, token as string);

    expect(exported.pubky.length).toBe(52);
    expect(exported.path).toBe(
      `pubky://${exported.pubky}/pub/hypercolor.app/v1/backup/latest`,
    );
    expect(exported.displayName).toBe("backup-restore-peer");
    expect(exported.body).toBe("backup-restore-body");

    await pageB.goto(`${BASE_URL}/e2e/backup-harness`);
    await waitHarness(pageB);

    const restored = await pageB.evaluate(
      async (input) => {
        const run = window.runBackupRestore;
        if (!run) throw new Error("window.runBackupRestore is not installed");
        return run(input);
      },
      { ownerPubky: exported.pubky, recoveryCode: exported.recoveryCode },
    );

    expect(restored.ownerPubky).toBe(exported.pubky);
    expect(restored.contactPubky).toBe(exported.contactPubky);
    expect(restored.displayName).toBe(exported.displayName);
    expect(restored.body).toBe(exported.body);
  } finally {
    await browserA.close();
    await browserB.close();
  }
});
