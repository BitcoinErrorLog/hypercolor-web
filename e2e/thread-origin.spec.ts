import { expect, test } from "@playwright/test";

const CONTACT = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const CONTACT_PATH = `/contacts/${encodeURIComponent(CONTACT)}`;

test.describe("thread origin in the static chats surface", () => {
  test("stored chats origin does not crash /chats", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
    await page.goto("/chats");
    await expect(page.getByTestId("chatsScreen")).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => {
      sessionStorage.setItem("hypercolor.thread-origin", JSON.stringify({ kind: "chats" }));
    });
    await page.reload();
    await expect(page.getByTestId("chatsScreen")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
    expect(errors.join("\n")).not.toMatch(/Maximum update depth|Minified React error #185/);
  });

  test("opening a chat from a contact renders the thread", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
    await page.goto(CONTACT_PATH);
    await expect(page.getByTestId("contactDetail")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("link", { name: "Message" }).click();
    await expect(page.getByTestId("threadScreen")).toBeVisible();
    await expect(page.getByTestId("detailBack")).toHaveAccessibleName("Back to Contact");
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
    expect(errors.join("\n")).not.toMatch(/Maximum update depth|Minified React error #185/);
  });

  test("client-side contact href mounts detail without a synthetic popstate", async ({ page }) => {
    await page.goto("/contacts");
    await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible({ timeout: 30_000 });
    await page.evaluate((path) => {
      const a = document.createElement("a");
      a.setAttribute("href", path);
      a.setAttribute("data-testid", "threadOriginContactHref");
      a.textContent = "Open contact";
      document.body.appendChild(a);
    }, CONTACT_PATH);
    await page.getByTestId("threadOriginContactHref").click();
    await expect(page).toHaveURL(new RegExp(`/contacts/${CONTACT}`));
    await expect(page.getByTestId("contactDetail")).toBeVisible({ timeout: 30_000 });
  });

  test("detail heading hydrates without a mismatch on desktop and mobile", async ({ page }) => {
    const messages: string[] = [];
    page.on("console", (msg) => {
      messages.push(msg.text());
    });
    page.on("pageerror", (error) => {
      messages.push(error.message);
    });
    for (const width of [1280, 390] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(CONTACT_PATH);
      await expect(page.getByTestId("contactDetail")).toBeVisible({ timeout: 30_000 });
      const heading = page.locator("[data-testid=contactDetail]").locator("h1, h2").first();
      await expect(heading).toBeVisible();
      if (width >= 768) {
        await expect(page.locator("[data-testid=contactDetail] h2").first()).toBeVisible();
      } else {
        await expect(page.locator("[data-testid=contactDetail] h1").first()).toBeVisible();
      }
    }
    expect(messages.join("\n")).not.toMatch(
      /hydrat|did not match|Minified React error #418|#419|#422|#423|#425/i,
    );
  });
});
