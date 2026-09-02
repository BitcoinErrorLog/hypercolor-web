import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.describe("empty-state product screens", () => {
  test("welcome landing titles Hypercolor", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Hypercolor" })).toBeVisible();
    await expect(page.getByTestId("welcomeScanHint")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Pubky Ring holds your key. Hypercolor never sees it.")).toBeVisible();
  });

  test("primary nav has four destinations and no Discover/Requests/Settings", async ({ page }) => {
    await page.goto("/chats");
    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible({ timeout: 30_000 });
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: /^Chats/ })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Channels" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Contacts" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Profile" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Discover" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Requests" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });

  test("chats empty state", async ({ page }) => {
    await page.goto("/chats");
    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("chatsEmpty")).toContainText("No chats yet.");
    await expect(page.getByTestId("chatsRequests")).toBeVisible();
    await expect(page.getByTestId("chatsRequests")).toContainText("Message requests");
  });

  test("channels empty state", async ({ page }) => {
    await page.goto("/channels");
    await expect(page.getByRole("heading", { name: "Channels" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("channelsEmpty")).toContainText("No private groups yet.");
    await expect(page.getByRole("tab", { name: "Private" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Public" })).toBeVisible();
  });

  test("contacts empty state", async ({ page }) => {
    await page.goto("/contacts");
    await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("contactsEmpty")).toContainText("No contacts yet");
  });

  test("requests empty state", async ({ page }) => {
    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: "Message requests" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("requestsEmpty")).toContainText("No pending requests");
    await expect(page.getByTestId("requestsInvite")).toBeVisible();
  });

  test("settings backup and session copy", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("settingsBackup")).toBeVisible();
    await expect(page.getByTestId("settingsRestore")).toBeVisible();
    await expect(page.getByTestId("settingsSignOut")).toBeVisible();
    await expect(
      page.getByText("Pubky Ring holds your key. Hypercolor never sees it."),
    ).toBeVisible();
  });

  test("profile empty identity", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Not connected")).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  });

  test("detail Back is visible at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("detailBack")).toBeVisible();
    await expect(page.getByTestId("detailBack")).toHaveAccessibleName("Back to Profile");
    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: "Message requests" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("detailBack")).toBeVisible();
    await expect(page.getByTestId("detailBack")).toHaveAccessibleName("Back to Chats");
  });

  test("recovery-code gate blocks in-app navigation", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __hypercolorSetBackupGate?: unknown })
          .__hypercolorSetBackupGate === "function",
    );
    await page.evaluate(() => {
      const host = window as unknown as {
        __hypercolorSetBackupGate?: (next: {
          recoveryCode: string | null;
          confirmedSaved: boolean;
        }) => void;
      };
      host.__hypercolorSetBackupGate?.({
        recoveryCode: "abcd1234wxyz",
        confirmedSaved: false,
      });
    });
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Chats/ }).click();
    await expect(page.getByTestId("backupLeaveDialog")).toBeVisible();
    await expect(page.getByText("Leave without saving your recovery code?")).toBeVisible();
    await page.getByTestId("backupLeaveStay").click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
  });
});
