import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function gotoSettings(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __hypercolorSetBackupGate?: unknown })
        .__hypercolorSetBackupGate === "function",
  );
}

async function armGate(page: Page, confirmedSaved = false) {
  await page.evaluate((saved) => {
    const host = window as unknown as {
      __hypercolorSetBackupGate?: (next: {
        recoveryCode: string | null;
        confirmedSaved: boolean;
      }) => void;
    };
    host.__hypercolorSetBackupGate?.({
      recoveryCode: "abcd1234wxyz",
      confirmedSaved: saved,
    });
  }, confirmedSaved);
}

async function clearGate(page: Page) {
  await page.evaluate(() => {
    const host = window as unknown as {
      __hypercolorSetBackupGate?: (next: {
        recoveryCode: string | null;
        confirmedSaved: boolean;
      }) => void;
    };
    host.__hypercolorSetBackupGate?.({ recoveryCode: null, confirmedSaved: false });
  });
}

async function chatsNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Chats/ });
}

test.describe("recovery-code gate attack matrix", () => {
  test.afterEach(async ({ page }) => {
    await clearGate(page).catch(() => undefined);
  });

  test("nav anchor click is blocked and Stay keeps Settings", async ({ page }) => {
    await gotoSettings(page);
    await armGate(page);
    await (await chatsNav(page)).click();
    await expect(page.getByTestId("backupLeaveDialog")).toBeVisible();
    await expect(page.getByText("Leave without saving your recovery code?")).toBeVisible();
    await page.getByTestId("backupLeaveStay").click();
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings/);
    await (await chatsNav(page)).click();
    await expect(page.getByTestId("backupLeaveDialog")).toBeVisible();
  });

  test("keyboard Enter and Space on an anchor are blocked", async ({ page }) => {
    await gotoSettings(page);
    await armGate(page);
    const chats = await chatsNav(page);
    await chats.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("backupLeaveDialog")).toBeVisible();
    await page.getByTestId("backupLeaveStay").click();
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
    await chats.focus();
    await page.keyboard.press(" ");
    await expect(page.getByTestId("backupLeaveDialog")).toBeVisible();
    await page.getByTestId("backupLeaveStay").click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test("browser Back after settle is blocked", async ({ page }) => {
    await page.goto("/profile");
    await gotoSettings(page);
    await armGate(page);
    await page.waitForTimeout(50);
    await page.goBack();
    await expect(page.getByTestId("backupLeaveDialog")).toBeVisible();
    await page.getByTestId("backupLeaveStay").click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test("immediate Back in the same turn as gate activation is blocked", async ({ page }) => {
    await page.goto("/profile");
    await gotoSettings(page);
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
      history.back();
    });
    await expect(page.getByTestId("backupLeaveDialog")).toBeVisible();
    await page.getByTestId("backupLeaveStay").click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test("Settings Back to Profile is blocked", async ({ page }) => {
    await gotoSettings(page);
    await armGate(page);
    await page.getByTestId("detailBack").click();
    await expect(page.getByTestId("backupLeaveDialog")).toBeVisible();
    await page.getByTestId("backupLeaveStay").click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("Leave anyway navigates and clears the gate", async ({ page }) => {
    await gotoSettings(page);
    await armGate(page);
    await (await chatsNav(page)).click();
    await expect(page.getByTestId("backupLeaveDialog")).toBeVisible();
    await page.getByTestId("backupLeaveAnyway").click();
    await expect(page).toHaveURL(/\/chats/);
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Profile" }).click();
    await expect(page).toHaveURL(/\/profile/);
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
  });

  test("checkbox and Done then leave without a dialog", async ({ page }) => {
    await gotoSettings(page);
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __hypercolorShowRecovery?: unknown })
          .__hypercolorShowRecovery === "function",
    );
    await page.evaluate(() => {
      const host = window as unknown as { __hypercolorShowRecovery?: (code: string) => void };
      host.__hypercolorShowRecovery?.("abcd1234wxyz");
    });
    await expect(page.getByTestId("recoveryCode")).toBeVisible();
    await page.getByTestId("recoveryCodeSaved").check();
    await page.getByTestId("recoveryCodeDone").click();
    await expect(page.getByTestId("recoveryCodePanel")).toHaveCount(0);
    await (await chatsNav(page)).click();
    await expect(page).toHaveURL(/\/chats/);
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
  });

  test("hash-only changes stay on Settings without a dialog", async ({ page }) => {
    await gotoSettings(page);
    await armGate(page);
    await page.evaluate(() => {
      location.hash = "backup";
    });
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings#backup/);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("beforeunload is armed while the code is unsaved", async ({ page }) => {
    await gotoSettings(page);
    await armGate(page);
    const result = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
      window.dispatchEvent(event);
      return {
        defaultPrevented: event.defaultPrevented,
        returnValue: String(event.returnValue ?? ""),
      };
    });
    expect(result.defaultPrevented).toBe(true);
  });

  test("unmount after Leave anyway does not leave a stray gate", async ({ page }) => {
    await gotoSettings(page);
    await armGate(page);
    await page.getByTestId("detailBack").click();
    await page.getByTestId("backupLeaveAnyway").click();
    await expect(page).toHaveURL(/\/profile/);
    await page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await (await chatsNav(page)).click();
    await expect(page).toHaveURL(/\/chats/);
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
  });
});
