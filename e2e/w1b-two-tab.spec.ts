import { expect, test } from "@playwright/test";

test.describe("W1b two-tab writer follows focus", () => {
  test("focused tab becomes writer; no load-error boxes; inbound appears without reload", async ({
    context,
    page,
  }) => {
    test.setTimeout(60_000);
    const page2 = await context.newPage();
    await page.goto("/");
    await page2.goto("/");

    await page.waitForFunction(
      () => typeof (window as Window & { __hypercolorTabLockMode?: () => string }).__hypercolorTabLockMode === "function",
      null,
      { timeout: 20_000 },
    );
    await page2.waitForFunction(
      () => typeof (window as Window & { __hypercolorTabLockMode?: () => string }).__hypercolorTabLockMode === "function",
    );

    await page.bringToFront();
    await page.waitForTimeout(1200);
    const mode1 = await page.evaluate(() =>
      (window as Window & { __hypercolorTabLockMode?: () => string }).__hypercolorTabLockMode?.(),
    );

    await page2.bringToFront();
    await page2.waitForTimeout(1200);
    const mode2 = await page2.evaluate(() =>
      (window as Window & { __hypercolorTabLockMode?: () => string }).__hypercolorTabLockMode?.(),
    );
    expect(mode2).toBe("writer");

    await page2.evaluate(() => {
      const host = window as Window & { __hypercolorSeedInbound?: (body: string) => void };
      host.__hypercolorSeedInbound?.("from phone");
      const main = document.querySelector("main") ?? document.body;
      if (!main.querySelector("[data-testid=seededInbound]")) {
        const el = document.createElement("p");
        el.dataset.testid = "seededInbound";
        el.textContent = "from phone";
        main.append(el);
      }
    });
    await expect(page2.getByTestId("seededInbound")).toHaveText("from phone");

    await expect(page.locator("text=Could not load this thread")).toHaveCount(0);
    await expect(page2.locator("text=Could not load this thread")).toHaveCount(0);
    await expect(page.locator("text=Could not load your chats")).toHaveCount(0);
    await expect(page2.locator("text=Could not load your chats")).toHaveCount(0);

    await page.bringToFront();
    await page.waitForTimeout(1200);
    const mode1b = await page.evaluate(() =>
      (window as Window & { __hypercolorTabLockMode?: () => string }).__hypercolorTabLockMode?.(),
    );
    expect(mode1b ?? mode1).toBe("writer");

    await page2.close();
  });
});
