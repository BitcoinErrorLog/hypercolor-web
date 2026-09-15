import { expect, test } from "@playwright/test";

test("ring-callback without params explains the miss", async ({ page }) => {
  await page.goto("/ring-callback");
  await expect(page.getByRole("heading", { name: "Ring callback" })).toBeVisible();
  await expect(page.getByText("Missing channel id")).toBeVisible();
});

test("ring-callback document opts out of Referer", async ({ page }) => {
  await page.goto("/ring-callback");
  const referrer = page.locator('meta[name="referrer"]');
  await expect(referrer).toHaveAttribute("content", "no-referrer");
});

test("welcome shows a paykit-connect QR and a copy control", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hypercolor" })).toBeVisible();
  await expect(page.getByTestId("welcomeQr")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("welcomeCopy")).toBeVisible();
  await expect(page.getByTestId("welcomeOpenRing")).toBeVisible();
  const img = page.getByTestId("welcomeQr").locator("img");
  await expect(img).toHaveAttribute("src", /data:image\/png;base64,/);
});
