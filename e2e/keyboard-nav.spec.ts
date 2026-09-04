import { expect, test, type Locator, type Page } from "@playwright/test";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type PrimaryRoute = {
  name: string;
  scene: string;
  cta: { testId?: string; role?: "button" | "link"; name?: string };
  opensSheet?: boolean;
};

const PRIMARY_ROUTES: PrimaryRoute[] = [
  { name: "connect", scene: "welcome-qr-populated", cta: { testId: "welcomeCancel" } },
  { name: "enable", scene: "enable-waiting-qr", cta: { role: "button", name: "Not now" } },
  { name: "chats list", scene: "chats-populated", cta: { testId: "chatsNew" } },
  {
    name: "thread",
    scene: "thread-populated",
    cta: { testId: "threadAttach" },
    opensSheet: true,
  },
  { name: "contacts", scene: "contacts-populated", cta: { testId: "contactSearchLookup" } },
  {
    name: "settings",
    scene: "settings-default",
    cta: { testId: "settingsSignOut" },
    opensSheet: true,
  },
];

function ctaLocator(page: Page, route: PrimaryRoute): Locator {
  if (route.cta.testId) return page.getByTestId(route.cta.testId);
  return page.getByRole(route.cta.role ?? "button", { name: route.cta.name! });
}

async function sceneFocusables(page: Page, sceneId: string) {
  return page.evaluate(
    ({ sceneId: id, selector }) => {
      const root = document.querySelector(`[data-vrt-scene="${id}"]`);
      if (!(root instanceof HTMLElement)) return [];
      return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => {
        if (el.hasAttribute("disabled")) return false;
        if (el.getAttribute("aria-hidden") === "true") return false;
        if (el.getAttribute("tabindex") === "-1") return false;
        return el.getClientRects().length > 0;
      }).map((el, index) => {
        const rect = el.getBoundingClientRect();
        return {
          index,
          tag: el.tagName.toLowerCase(),
          testId: el.getAttribute("data-testid"),
          name: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 80) || "",
          top: rect.top,
          left: rect.left,
        };
      });
    },
    { sceneId, selector: FOCUSABLE_SELECTOR },
  );
}

async function focusDecoration(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return null;
    const focused = getComputedStyle(el);
    const probe = el.cloneNode(false) as HTMLElement;
    probe.removeAttribute("autofocus");
    el.insertAdjacentElement("afterend", probe);
    const unfocused = getComputedStyle(probe);
    const result = {
      outline: focused.outline,
      boxShadow: focused.boxShadow,
      unfocusedOutline: unfocused.outline,
      unfocusedBoxShadow: unfocused.boxShadow,
      differs:
        focused.outline !== unfocused.outline || focused.boxShadow !== unfocused.boxShadow,
    };
    probe.remove();
    return result;
  });
}

async function tabThroughScene(page: Page, sceneId: string) {
  await page.locator("body").click({ position: { x: 0, y: 0 } });
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });

  const expected = await sceneFocusables(page, sceneId);
  expect(expected.length, `${sceneId} has no interactive controls`).toBeGreaterThan(0);
  const visual = [...expected].sort((a, b) => {
    if (Math.abs(a.top - b.top) > 8) return a.top - b.top;
    return a.left - b.left;
  });

  const visited: string[] = [];
  const firstKey = () => {
    const el = visited[0];
    return el;
  };
  let wrapped = false;
  const bound = Math.max(40, expected.length * 3 + 8);

  for (let i = 0; i < bound; i++) {
    await page.keyboard.press("Tab");
    const key = await page.evaluate((id) => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return null;
      const root = document.querySelector(`[data-vrt-scene="${id}"]`);
      if (!(root instanceof HTMLElement) || !root.contains(el)) return `outside:${el.tagName}`;
      return [
        el.tagName.toLowerCase(),
        el.getAttribute("data-testid") ?? "",
        el.getAttribute("aria-label") ?? "",
        el.textContent?.trim().slice(0, 80) ?? "",
      ].join("|");
    }, sceneId);
    if (!key || key.startsWith("outside:")) continue;
    if (visited.length > 0 && key === firstKey()) {
      wrapped = true;
      break;
    }
    if (!visited.includes(key)) visited.push(key);
  }

  expect(wrapped, `${sceneId} focus did not return to the first control within ${bound} Tabs`).toBe(
    true,
  );

  const visualKeys = visual.map((item) =>
    `${item.tag}|${item.testId ?? ""}|${item.name}`.replace(/\s+/g, " ").trim(),
  );
  const visitedNormalized = visited.map((key) => key.replace(/\s+/g, " ").trim());
  for (const item of visual) {
    const needle = `${item.tag}|${item.testId ?? ""}`;
    expect(
      visitedNormalized.some((key) => key.startsWith(needle)),
      `${sceneId} never reached ${item.tag} ${item.testId ?? item.name} via Tab`,
    ).toBe(true);
  }

  const inSceneVisitOrder = visitedNormalized.filter((key) =>
    visualKeys.some((visualKey) => {
      const [tag, testId] = visualKey.split("|");
      return key.startsWith(`${tag}|${testId}`);
    }),
  );
  const visualByTestId = visual.map((item) => `${item.tag}|${item.testId ?? ""}`);
  const visitByTestId = inSceneVisitOrder.map((key) => {
    const [tag, testId] = key.split("|");
    return `${tag}|${testId}`;
  });
  expect(visitByTestId, `${sceneId} Tab order vs visual order`).toEqual(visualByTestId);
}

async function assertCtaActivation(locator: Locator, key: "Enter" | "Space") {
  await locator.evaluate((el) => {
    el.addEventListener(
      "click",
      () => {
        el.setAttribute("data-cta-activated", "1");
      },
      { once: true },
    );
  });
  await locator.press(key);
  await expect(locator).toHaveAttribute("data-cta-activated", "1");
}

function sheetLocator(page: Page, route: PrimaryRoute) {
  if (route.cta.testId === "settingsSignOut") return page.getByTestId("signOutDialog");
  return page.getByTestId("threadAttachMenu");
}

test.describe("keyboard navigation on primary catalog routes", () => {
  for (const route of PRIMARY_ROUTES) {
    test(`${route.name} (${route.scene})`, async ({ page }) => {
      await page.goto(`/e2e/ux-catalog?scene=${route.scene}`);
      const marker = page.locator(`[data-vrt-scene="${route.scene}"]`);
      await expect(marker).toBeVisible({ timeout: 30_000 });

      await tabThroughScene(page, route.scene);

      await page.locator("body").click({ position: { x: 0, y: 0 } });
      await page.keyboard.press("Tab");
      const ring = await focusDecoration(page);
      expect(ring, `${route.scene} Tab did not land on a control`).not.toBeNull();
      expect(ring!.differs, `${route.scene} focused control has no visible outline/box-shadow change`).toBe(
        true,
      );

      const cta = ctaLocator(page, route);
      await expect(cta).toBeVisible();

      if (route.opensSheet) {
        const sheet = sheetLocator(page, route);
        await cta.press("Enter");
        await expect(sheet).toBeVisible();
        await expect(sheet.locator("button, [role='menuitem']").first()).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(sheet).toHaveCount(0);
        await expect(cta).toBeFocused();

        await cta.press("Space");
        await expect(sheet).toBeVisible();
        await expect(sheet.locator("button, [role='menuitem']").first()).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(sheet).toHaveCount(0);
        await expect(cta).toBeFocused();
      } else {
        await assertCtaActivation(cta, "Enter");
        await assertCtaActivation(cta, "Space");
      }
    });
  }
});
