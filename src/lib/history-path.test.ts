/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  subscribeHistoryPath,
  readWindowPathname,
  resetHistoryPathForTests,
} from "./history-path";

describe("history-path", () => {
  afterEach(() => {
    resetHistoryPathForTests();
    window.history.replaceState({}, "", "/");
  });

  it("notifies on pushState without a popstate", () => {
    const calls: string[] = [];
    const stop = subscribeHistoryPath(() => {
      calls.push(readWindowPathname());
    });
    window.history.pushState({}, "", "/contacts/abc");
    expect(calls).toEqual(["/contacts/abc"]);
    expect(readWindowPathname()).toBe("/contacts/abc");
    stop();
  });

  it("notifies on replaceState", () => {
    const calls: string[] = [];
    const stop = subscribeHistoryPath(() => {
      calls.push(readWindowPathname());
    });
    window.history.replaceState({}, "", "/chats/dm%3A1");
    expect(calls).toEqual(["/chats/dm%3A1"]);
    stop();
  });

  it("notifies on popstate", () => {
    window.history.replaceState({}, "", "/contacts");
    const calls: string[] = [];
    const stop = subscribeHistoryPath(() => {
      calls.push(readWindowPathname());
    });
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(calls.at(-1)).toBe("/contacts");
    stop();
  });

  it("notifies when History.prototype.pushState is invoked without a popstate", () => {
    const calls: string[] = [];
    const stop = subscribeHistoryPath(() => {
      calls.push(readWindowPathname());
    });
    History.prototype.pushState.call(window.history, {}, "", "/contacts/proto");
    expect(calls).toEqual(["/contacts/proto"]);
    expect(readWindowPathname()).toBe("/contacts/proto");
    stop();
  });

  it("restores History.prototype methods after the last subscriber leaves", () => {
    const nativePush = History.prototype.pushState;
    const stop = subscribeHistoryPath(() => undefined);
    expect(History.prototype.pushState).not.toBe(nativePush);
    stop();
    expect(History.prototype.pushState).toBe(nativePush);
    expect(window.history.pushState).toBe(nativePush);
  });

  it("notifies when a same-origin click follows a native pushState the wrap missed", async () => {
    const nativePush = History.prototype.pushState;
    const calls: string[] = [];
    const stop = subscribeHistoryPath(() => {
      calls.push(readWindowPathname());
    });
    Object.defineProperty(History.prototype, "pushState", {
      configurable: true,
      writable: true,
      value: nativePush,
    });
    nativePush.call(window.history, {}, "", "/contacts/native");
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "/contacts/native");
    document.body.append(anchor);
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    expect(calls.at(-1)).toBe("/contacts/native");
    expect(readWindowPathname()).toBe("/contacts/native");
    anchor.remove();
    stop();
  });

  it("does not install any setInterval polling timer even in non-jsdom browsers", () => {
    const originalUa = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15",
    });
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    try {
      const stop = subscribeHistoryPath(() => undefined);
      expect(setIntervalSpy).not.toHaveBeenCalled();
      stop();
    } finally {
      setIntervalSpy.mockRestore();
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: originalUa,
      });
    }
  });
});
