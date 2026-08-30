import { expect, test } from "@playwright/test";

test("static home page titles Hypercolor", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hypercolor" })).toBeVisible();
});
