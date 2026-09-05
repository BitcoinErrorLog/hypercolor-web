/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THREAD_INBOX_POLL_MS,
  createThreadInboxPoller,
} from "./thread-inbox-poll";

describe("createThreadInboxPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls at THREAD_INBOX_POLL_MS while visible and stops when hidden or unmounted", async () => {
    const sync = vi.fn(async () => undefined);
    let visible = true;
    const poller = createThreadInboxPoller({
      sync,
      isVisible: () => visible,
      documentRef: document,
      windowRef: window,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(THREAD_INBOX_POLL_MS);
    expect(sync).toHaveBeenCalledTimes(2);

    visible = false;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(THREAD_INBOX_POLL_MS * 3);
    expect(sync).toHaveBeenCalledTimes(2);

    visible = true;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(3);

    poller.stop();
    await vi.advanceTimersByTimeAsync(THREAD_INBOX_POLL_MS * 3);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("skips overlapping syncs", async () => {
    vi.useRealTimers();
    const sync = vi.fn(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 40);
      });
    });
    const poller = createThreadInboxPoller({
      sync,
      isVisible: () => true,
    });
    poller.start();
    await vi.waitFor(() => {
      expect(sync).toHaveBeenCalledTimes(1);
    });
    void poller.kick();
    void poller.kick();
    expect(sync).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => {
      setTimeout(resolve, 60);
    });
    await poller.kick();
    expect(sync).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("kicks immediately on focus while visible", async () => {
    const sync = vi.fn(async () => undefined);
    const poller = createThreadInboxPoller({
      sync,
      isVisible: () => true,
      documentRef: document,
      windowRef: window,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(2);
    poller.stop();
  });
});
