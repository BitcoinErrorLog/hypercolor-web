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

async function showRecovery(page: Page, code = "abcd1234wxyz") {
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __hypercolorShowRecovery?: unknown })
        .__hypercolorShowRecovery === "function",
  );
  await page.evaluate((recoveryCode) => {
    const host = window as unknown as { __hypercolorShowRecovery?: (code: string) => void };
    host.__hypercolorShowRecovery?.(recoveryCode);
  }, code);
}

async function readGate(page: Page) {
  return page.evaluate(() => {
    const host = window as unknown as {
      __hypercolorGetBackupGate?: () => { recoveryCode: string | null; confirmedSaved: boolean };
    };
    return {
      href: location.pathname,
      gate: host.__hypercolorGetBackupGate?.() ?? null,
    };
  });
}

async function expectCodeSurvivesWithDialog(page: Page) {
  await expect.poll(async () => {
    try {
      const snapshot = await readGate(page);
      return {
        code: Boolean(snapshot.gate?.recoveryCode),
        dialog: await page.getByTestId("backupLeaveDialog").count(),
      };
    } catch {
      return { code: false, dialog: 0 };
    }
  }).toEqual({ code: true, dialog: 1 });
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

  test("Sign out while the code is shown stacks the gate above the sheet", async ({ page }) => {
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
    await page.getByTestId("settingsSignOut").click();
    await expect(page.getByTestId("signOutDialog")).toBeVisible();
    await page.getByTestId("signOutConfirm").click();
    await expect(page.getByTestId("signOutDialog")).toHaveCount(0);
    const gate = page.getByTestId("backupLeaveDialog");
    await expect(gate).toBeVisible();
    await expect(page.getByTestId("backupLeaveStay")).toBeFocused();
    const topmost = await page.evaluate(() => {
      const stay = document.querySelector("[data-testid=backupLeaveStay]");
      if (!(stay instanceof HTMLElement)) return { insideGate: false };
      const box = stay.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {
        insideGate: Boolean(hit?.closest("[data-testid=backupLeaveDialog]")),
        zIndex: getComputedStyle(
          document.querySelector("[data-testid=backupLeaveDialog]")!,
        ).zIndex,
      };
    });
    expect(topmost.insideGate).toBe(true);
    expect(topmost.zIndex).toBe("60");
    await page.getByTestId("backupLeaveStay").click();
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByTestId("recoveryCode")).toBeVisible();
    await expect(page.getByTestId("settingsSignOut")).toBeFocused();
    await page.getByTestId("settingsSignOut").click();
    await page.getByTestId("signOutConfirm").click();
    await expect(page.getByTestId("backupLeaveDialog")).toBeVisible();
    await page.getByTestId("backupLeaveAnyway").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
  });

  test("one-turn double Back keeps the recovery code and shows the gate", async ({ page }) => {
    await page.goto("/profile");
    await gotoSettings(page);
    await showRecovery(page);
    await expect(page.getByTestId("recoveryCode")).toBeVisible();
    await page.evaluate(() => {
      history.back();
      history.back();
    });
    await expectCodeSurvivesWithDialog(page);
    await page.getByTestId("backupLeaveStay").click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByTestId("recoveryCode")).toBeVisible();
  });

  test("history.go(-2) (Back long-press equivalent) keeps the recovery code and shows the gate", async ({ page }) => {
    await page.goto("/profile");
    await gotoSettings(page);
    await showRecovery(page);
    await expect(page.getByTestId("recoveryCode")).toBeVisible();
    await page.evaluate(() => {
      history.go(-2);
    });
    await expectCodeSurvivesWithDialog(page);
    await page.getByTestId("backupLeaveStay").click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByTestId("recoveryCode")).toBeVisible();
  });

  test("Leave anyway then a single Back is a real navigation", async ({ page }) => {
    await page.goto("/profile");
    await gotoSettings(page);
    await armGate(page);
    await page.getByTestId("detailBack").click();
    await expect(page.getByTestId("backupLeaveDialog")).toBeVisible();
    await page.getByTestId("backupLeaveAnyway").click();
    await expect(page).toHaveURL(/\/profile/);
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
    expect((await readGate(page)).gate?.recoveryCode ?? null).toBeNull();
    expect(
      await page.evaluate(() => Boolean((history.state as { backupGate?: boolean } | null)?.backupGate)),
    ).toBe(false);
    await page.goBack();
    await expect(page).toHaveURL(/\/profile/);
  });

  test("parked gate marks main inert on Settings and after an off-route escape", async ({ page }) => {
    await page.goto("/profile");
    await gotoSettings(page);
    await showRecovery(page);
    await page.getByTestId("detailBack").click();
    await expect(page.getByTestId("backupLeaveDialog")).toBeVisible();
    await expect.poll(() =>
      page.evaluate(() => document.getElementById("main-content")?.inert === true),
    ).toBe(true);
    const forcedOnSettings = await page.evaluate(() => {
      const trigger = document.querySelector("[data-testid=settingsSignOut]");
      if (!(trigger instanceof HTMLButtonElement)) return { opened: false };
      trigger.click();
      return { opened: document.querySelector("[data-testid=signOutDialog]") !== null };
    });
    expect(forcedOnSettings.opened).toBe(false);
    await expect(page.getByTestId("signOutDialog")).toHaveCount(0);
    await page.getByTestId("backupLeaveStay").click();
    await expect(page).toHaveURL(/\/settings/);
    await expect.poll(() =>
      page.evaluate(() => document.getElementById("main-content")?.inert === true),
    ).toBe(false);

    await page.evaluate(() => {
      history.pushState({ escaped: true }, "", "/profile");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expectCodeSurvivesWithDialog(page);
    await expect.poll(() =>
      page.evaluate(() => document.getElementById("main-content")?.inert === true),
    ).toBe(true);
    await page.getByTestId("backupLeaveStay").click();
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
    await expect.poll(() =>
      page.evaluate(() => document.getElementById("main-content")?.inert === true),
    ).toBe(false);
  });

  test("checkbox and Done then a single Back lands on the previous route", async ({ page }) => {
    await page.goto("/profile");
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
    await page.getByTestId("recoveryCodeSaved").check();
    await page.getByTestId("recoveryCodeDone").click();
    await expect(page.getByTestId("recoveryCodePanel")).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/profile/);
    await expect(page.getByTestId("backupLeaveDialog")).toHaveCount(0);
  });

  test("browser Forward after arming stays on Settings", async ({ page }) => {
    await page.goto("/profile");
    await gotoSettings(page);
    await armGate(page);
    await page.goForward();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("list routes expose exactly one h1", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const path of ["/chats", "/channels", "/contacts", "/profile", "/settings", "/requests", "/enable"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
    }
  });
});

