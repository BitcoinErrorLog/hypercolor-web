import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GENERATE = process.env.STAGING_INVITE_SCRIPT?.trim() ?? "";

async function resolveSignupToken(): Promise<string | null> {
  const fromEnv = process.env.STAGING_SIGNUP_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.RUN_STAGING_OWNER_ROUNDTRIP !== "1") return null;
  if (!GENERATE) throw new Error("STAGING_INVITE_SCRIPT is not set");
  const { stdout } = await execFileAsync("bash", [GENERATE], {
    timeout: 20_000,
  });
  const token = stdout.trim();
  return token.length > 0 ? token : null;
}

test("staging owner PUT → public GET → DELETE → 404", async ({ page }) => {
  test.setTimeout(120_000);
  const token = await resolveSignupToken();
  test.skip(
    !token,
    [
      "Live staging proof skipped (no token).",
      "Mint a token (do not commit it) and rerun:",
      `  bash ${GENERATE}`,
      "  STAGING_SIGNUP_TOKEN=<token> npm run test:e2e -- e2e/owner-roundtrip.spec.ts",
      "Or: RUN_STAGING_OWNER_ROUNDTRIP=1 npm run test:e2e -- e2e/owner-roundtrip.spec.ts",
    ].join("\n"),
  );

  await page.goto("/e2e/owner-roundtrip");
  await expect(
    page.getByRole("heading", { name: "Owner round-trip harness" }),
  ).toBeVisible();
  await page.waitForFunction(() => typeof window.runOwnerRoundtrip === "function");

  const result = await page.evaluate(async (signupToken) => {
    const run = (
      window as unknown as {
        runOwnerRoundtrip?: (value: string) => Promise<{
          pubky: string;
          putOk: boolean;
          getOk: boolean;
          deleteOk: boolean;
          gone: boolean;
        }>;
      }
    ).runOwnerRoundtrip;
    if (!run) throw new Error("window.runOwnerRoundtrip is not installed");
    return run(signupToken);
  }, token as string);

  expect(result.putOk).toBe(true);
  expect(result.getOk).toBe(true);
  expect(result.deleteOk).toBe(true);
  expect(result.gone).toBe(true);
  expect(result.pubky.length).toBe(52);
});
