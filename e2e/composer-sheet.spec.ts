import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("composer attach sheet traps focus, arrows, Escape, and restores the trigger", async ({
  page,
}) => {
  await page.goto("/e2e/composer-sheet");
  const trigger = page.getByTestId("harnessAttach");
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  const menu = page.getByTestId("harnessAttachMenu");
  await expect(menu).toBeVisible();
  await expect(page.getByTestId("harnessAttachPhoto")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("harnessAttachFile")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("harnessAttachCancel")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("sign-out dialog traps Escape and returns focus to the trigger", async ({ page }) => {
  await page.goto("/settings");
  const trigger = page.getByTestId("settingsSignOut");
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  await expect(page.getByTestId("signOutDialog")).toBeVisible();
  await expect(page.getByTestId("signOutCancel")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("signOutDialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
