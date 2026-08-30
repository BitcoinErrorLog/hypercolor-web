import { expect, test } from "@playwright/test";

test.describe("empty-state product screens", () => {
  test("welcome landing titles Hypercolor", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Hypercolor" })).toBeVisible();
    await expect(page.getByTestId("welcomeScanHint")).toBeVisible({ timeout: 30_000 });
  });

  test("chats empty state", async ({ page }) => {
    await page.goto("/chats");
    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
    await expect(page.getByTestId("chatsEmpty")).toContainText("No conversations yet");
  });

  test("channels empty state", async ({ page }) => {
    await page.goto("/channels");
    await expect(page.getByRole("heading", { name: "Channels" })).toBeVisible();
    await expect(page.getByTestId("channelsEmpty")).toContainText("No channels yet");
    await expect(page.getByText(/established Encrypted Link/i)).toBeVisible();
  });

  test("contacts empty state", async ({ page }) => {
    await page.goto("/contacts");
    await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
    await expect(page.getByTestId("contactsEmpty")).toContainText("No contacts yet");
  });

  test("requests empty state", async ({ page }) => {
    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: "Message requests" })).toBeVisible();
    await expect(page.getByTestId("requestsEmpty")).toContainText("No pending requests");
  });

  test("settings backup and session copy", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByTestId("settingsBackup")).toBeVisible();
    await expect(page.getByTestId("settingsRestore")).toBeVisible();
    await expect(page.getByTestId("settingsSignOut")).toBeVisible();
  });

  test("profile empty identity", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(page.getByText("Not connected")).toBeVisible();
  });
});
