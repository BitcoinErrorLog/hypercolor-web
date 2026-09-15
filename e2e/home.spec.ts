import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("static home page titles Hypercolor", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hypercolor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect with Pubky Ring" })).toBeVisible();
});

test("home skip link and primary nav destinations", async ({ page }) => {
  await page.goto("/");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeAttached();
  await skip.focus();
  const box = await skip.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(1);
  expect(box!.height).toBeGreaterThan(1);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: /^Chats/ })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Channels" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Contacts" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Profile" })).toBeVisible();
});
