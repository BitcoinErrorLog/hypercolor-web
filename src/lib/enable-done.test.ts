import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearEnableCompleted,
  getEnableCompletedPubky,
  isEnableCompleted,
  markEnableCompleted,
  useEnableCompleted,
} from "./enable-done";

function EnableHookProbe() {
  const done = useEnableCompleted();
  return createElement(
    "p",
    { "data-testid": "enableMessagingStatus" },
    done ? "Encrypted messaging enabled" : "Waiting for Pubky Ring…",
  );
}

afterEach(() => {
  clearEnableCompleted();
  vi.unstubAllGlobals();
});

describe("enable-done", () => {
  it("remembers completion in memory when sessionStorage is missing", () => {
    expect(isEnableCompleted()).toBe(false);
    markEnableCompleted("pk:abc");
    expect(isEnableCompleted()).toBe(true);
    expect(getEnableCompletedPubky()).toBe("pk:abc");
    clearEnableCompleted();
    expect(isEnableCompleted()).toBe(false);
  });

  it("writes dataset hc-enable without patching status textContent", () => {
    const dataset: Record<string, string> = {};
    const querySelectorAll = vi.fn(() => [{ textContent: "Waiting for Pubky Ring…" }]);
    vi.stubGlobal("document", {
      documentElement: { dataset },
      querySelectorAll,
    });
    markEnableCompleted("pk:dom");
    expect(dataset.hcEnable).toBe("enabled");
    expect(querySelectorAll).not.toHaveBeenCalled();
  });

  it("first render after markEnableCompleted is completed without an effect", () => {
    markEnableCompleted("pk:hook");
    const html = renderToString(createElement(EnableHookProbe));
    expect(html).toContain("Encrypted messaging enabled");
    expect(html).not.toContain("Waiting for Pubky Ring…");
  });

  it("keeps completion across a simulated Fast Refresh re-import", async () => {
    markEnableCompleted("pk:pinned");
    const reimported = await import("./enable-done");
    expect(reimported.isEnableCompleted()).toBe(true);
    expect(reimported.getEnableCompletedPubky()).toBe("pk:pinned");
  });

  it("restores from sessionStorage after the module is reloaded", async () => {
    const store = new Map<string, string>();
    const dataset: Record<string, string> = {};
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });
    vi.stubGlobal("document", {
      documentElement: { dataset },
      querySelectorAll: () => [],
    });
    clearEnableCompleted();
    markEnableCompleted("pk:stored");
    expect(store.get("hc-enable-done")).toBe("pk:stored");
    expect(dataset.hcEnable).toBe("enabled");
    vi.resetModules();
    const second = await import("./enable-done");
    expect(second.isEnableCompleted()).toBe(true);
    expect(second.getEnableCompletedPubky()).toBe("pk:stored");
    second.clearEnableCompleted();
  });
});
