import { afterEach, beforeAll, describe, expect, it } from "vitest";

const FIXTURE_PUBKY = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

class FakeWindow extends EventTarget {
  __vibewareSink?: unknown;
}

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    value: new FakeWindow(),
    configurable: true,
  });
});

afterEach(async () => {
  const { resetMemorySink } = await import("./collector");
  resetMemorySink();
});

async function waitForSinkType(type: string): Promise<void> {
  const { getMemorySink } = await import("./collector");
  await new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (getMemorySink().some((event) => event.type === type)) {
        resolve();
        return;
      }
      if (Date.now() - started > 2_000) {
        reject(new Error(`timed out waiting for ${type}`));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

describe("vibeware CustomEvent ingress", () => {
  it("does not attach window.__vibewareSink without the e2e harness", async () => {
    const { emit, ensureVibewareListener } = await import("./collector");
    ensureVibewareListener();
    await emit("app.pwa.installed", { outcome: "accepted" });
    expect((window as FakeWindow).__vibewareSink).toBeUndefined();
  });

  it("does not land a forged CustomEvent that plants a pubky in route", async () => {
    const { getMemorySink, ensureVibewareListener } = await import("./collector");
    ensureVibewareListener();
    window.dispatchEvent(
      new CustomEvent("hypercolor-vibeware", {
        detail: {
          type: "app.route.viewed",
          payload: { route: FIXTURE_PUBKY, from_route: "none" },
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("hypercolor-vibeware", {
        detail: {
          type: "app.pwa.installed",
          payload: { outcome: "accepted" },
        },
      }),
    );
    await waitForSinkType("app.pwa.installed");
    expect(getMemorySink().some((event) => event.type === "app.pwa.installed")).toBe(true);
    expect(JSON.stringify(getMemorySink())).not.toContain(FIXTURE_PUBKY);
    expect(getMemorySink().some((event) => event.payload.route === FIXTURE_PUBKY)).toBe(false);
  });
});
