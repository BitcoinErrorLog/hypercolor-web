import { expect, test, type Page } from "@playwright/test";

type SinkEvent = {
  type: string;
  actor: string;
  privacy: { contains_user_content: boolean };
  payload: Record<string, unknown>;
};

async function readSink(page: Page): Promise<SinkEvent[]> {
  return page.evaluate(() => (window as unknown as { __vibewareSink?: SinkEvent[] }).__vibewareSink ?? []);
}

test.describe("vibeware collector sink", () => {
  test("allowlisted events appear and forged bodies do not persist", async ({ page }) => {
    const collected: SinkEvent[] = [];

    async function harvest() {
      collected.push(...(await readSink(page)));
    }

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Hypercolor" })).toBeVisible();
    await expect
      .poll(async () => (await readSink(page)).some((event) => event.type === "app.route.viewed"), {
        timeout: 15_000,
      })
      .toBe(true);
    await expect
      .poll(async () => (await readSink(page)).some((event) => event.type === "app.onboarding.state"), {
        timeout: 20_000,
      })
      .toBe(true);
    await harvest();

    await page.goto("/chats");
    await expect(page.getByTestId("chatsEmpty")).toBeVisible();
    await expect
      .poll(async () =>
        (await readSink(page)).some(
          (event) => event.type === "app.chat.empty_state" && event.payload.kind === "dms",
        ),
      )
      .toBe(true);
    await harvest();

    await page.goto("/channels");
    await expect(page.getByTestId("channelsEmpty")).toBeVisible();
    await expect
      .poll(async () =>
        (await readSink(page)).some(
          (event) => event.type === "app.chat.empty_state" && event.payload.kind === "groups",
        ),
      )
      .toBe(true);
    await harvest();

    await page.goto("/requests");
    await expect(page.getByTestId("requestsEmpty")).toBeVisible();
    await expect
      .poll(async () =>
        (await readSink(page)).some(
          (event) => event.type === "app.chat.empty_state" && event.payload.kind === "requests",
        ),
      )
      .toBe(true);
    await harvest();

    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("hypercolor-vibeware", {
          detail: {
            type: "app.thread.send_settled",
            payload: {
              channel: "dm",
              outcome: "sent",
              kind: "text",
              body: "forged-message-body",
            },
          },
        }),
      );
    });

    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("hypercolor-vibeware", {
          detail: {
            type: "app.pwa.installed",
            payload: { outcome: "accepted" },
          },
        }),
      );
    });

    await expect
      .poll(async () => (await readSink(page)).some((event) => event.type === "app.pwa.installed"))
      .toBe(true);
    await harvest();

    const serialized = JSON.stringify(collected);
    expect(serialized).not.toContain("forged-message-body");
    expect(serialized).not.toMatch(/"pubky"/);
    expect(serialized).not.toMatch(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/);
    expect(collected.every((event) => event.privacy.contains_user_content === false)).toBe(true);
    expect(collected.some((event) => event.type === "app.route.viewed")).toBe(true);
    expect(
      collected.some((event) => event.type === "app.chat.empty_state" && event.payload.kind === "dms"),
    ).toBe(true);
    expect(
      collected.some((event) => event.type === "app.chat.empty_state" && event.payload.kind === "groups"),
    ).toBe(true);
    expect(
      collected.some((event) => event.type === "app.chat.empty_state" && event.payload.kind === "requests"),
    ).toBe(true);
    expect(collected.some((event) => event.type === "app.onboarding.state")).toBe(true);
    expect(collected.some((event) => event.type === "app.pwa.installed")).toBe(true);
  });
});
