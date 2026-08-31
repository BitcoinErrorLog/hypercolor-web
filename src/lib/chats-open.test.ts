import { afterEach, describe, expect, it, vi } from "vitest";
import { clearChatsRequested, isChatsRequested, markChatsRequested } from "./chats-open";

afterEach(() => {
  clearChatsRequested();
  vi.unstubAllGlobals();
});

describe("chats-open", () => {
  it("remembers a request in memory when sessionStorage is missing", () => {
    expect(isChatsRequested()).toBe(false);
    markChatsRequested();
    expect(isChatsRequested()).toBe(true);
    clearChatsRequested();
    expect(isChatsRequested()).toBe(false);
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
    vi.stubGlobal("document", { documentElement: { dataset } });
    vi.resetModules();
    const first = await import("./chats-open");
    first.markChatsRequested();
    expect(store.get("hc-chats-open")).toBe("1");
    expect(dataset.hcChatsOpen).toBe("1");
    vi.resetModules();
    const second = await import("./chats-open");
    expect(second.isChatsRequested()).toBe(true);
    second.clearChatsRequested();
  });
});
