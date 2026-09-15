import { expect, test } from "@playwright/test";

test.describe("W1b two-tab writer follows focus", () => {
  test("hidden holder yields over BroadcastChannel before the focused tab writes", async ({
    browserName,
    context,
    page,
  }) => {
    test.skip(browserName !== "chromium", "CDP Page.setWebLifecycleState is Chromium-only");
    test.setTimeout(60_000);
    const page2 = await context.newPage();
    await page.goto("/");
    await page2.goto("/");

    await page.waitForFunction(
      () =>
        typeof (window as Window & { __hypercolorEnsureWriter?: () => Promise<unknown> })
          .__hypercolorEnsureWriter === "function",
      null,
      { timeout: 20_000 },
    );
    await page2.waitForFunction(
      () =>
        typeof (window as Window & { __hypercolorEnsureWriter?: () => Promise<unknown> })
          .__hypercolorEnsureWriter === "function",
    );

    await page.evaluate(async () => {
      const host = window as Window & {
        __hypercolorTabLockTrace?: string[];
        __hypercolorEnsureWriter?: () => Promise<unknown>;
      };
      host.__hypercolorTabLockTrace = [];
      await host.__hypercolorEnsureWriter?.();
    });
    await page.waitForFunction(
      () =>
        (window as Window & { __hypercolorTabLockMode?: () => string }).__hypercolorTabLockMode?.() ===
        "writer",
    );

    const session = await page.context().newCDPSession(page);
    await session.send("Page.setWebLifecycleState", { state: "frozen" });

    await page2.bringToFront();
    await page2.evaluate(async () => {
      const host = window as Window & {
        __hypercolorTabLockTrace?: string[];
        __hypercolorEnsureWriter?: () => Promise<unknown>;
      };
      host.__hypercolorTabLockTrace = [];
      await host.__hypercolorEnsureWriter?.();
    });

    await page2.waitForFunction(
      () =>
        (window as Window & { __hypercolorTabLockMode?: () => string }).__hypercolorTabLockMode?.() ===
        "writer",
      null,
      { timeout: 8_000 },
    );

    const traces = await Promise.all([
      page.evaluate(
        () => (window as Window & { __hypercolorTabLockTrace?: string[] }).__hypercolorTabLockTrace ?? [],
      ),
      page2.evaluate(
        () => (window as Window & { __hypercolorTabLockTrace?: string[] }).__hypercolorTabLockTrace ?? [],
      ),
    ]);
    const combined = traces.flat();
    expect(combined).toContain("posted-yield-request");
    expect(combined).toContain("posted-yielded");

    await expect(page.locator("text=Could not load this thread")).toHaveCount(0);
    await expect(page2.locator("text=Could not load this thread")).toHaveCount(0);
    await expect(page.locator("text=Could not load your chats")).toHaveCount(0);
    await expect(page2.locator("text=Could not load your chats")).toHaveCount(0);

    await page2.close();
  });
});
