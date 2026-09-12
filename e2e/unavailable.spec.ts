import { expect, test } from "@playwright/test";

const productRoutes = [
  "/channels",
  "/channels/example",
  "/chats",
  "/chats/example",
  "/contacts",
  "/contacts/example",
  "/discover",
  "/discover/example",
  "/profile",
  "/requests",
  "/settings",
];

test("the entry point is terminally unavailable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hypercolorUnavailable")).toBeVisible();
  await expect(page.getByText("Hypercolor is unavailable")).toBeVisible();
});

for (const route of productRoutes) {
  test(`${route} is terminally unavailable`, async ({ request }) => {
    const response = await request.get(route);
    expect(response.status()).toBe(404);
    expect(await response.text()).toMatch(/Hypercolor is unavailable/);
  });
}
