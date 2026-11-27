/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
  getDatabase: vi.fn(),
}));

vi.mock("@/services/StorageService", () => ({
  StorageService: {},
}));

import {
  LinkService,
  startLinkRetryDrainOnVisibility,
  stopLinkRetryDrain,
} from "./LinkService";

describe("LinkService visibility-gated retry drain", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopLinkRetryDrain();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pauses the 30s retry drain when hidden and resumes on visible", () => {
    let state: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state,
    });
    const drainSpy = vi.spyOn(LinkService, "drainRetries").mockResolvedValue(undefined);
    const recoverSpy = vi.spyOn(LinkService, "recoverPendingSends").mockResolvedValue(undefined);

    const stop = startLinkRetryDrainOnVisibility(30_000);
    expect(drainSpy).toHaveBeenCalledTimes(1);
    expect(recoverSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    expect(drainSpy).toHaveBeenCalledTimes(2);

    state = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(120_000);
    expect(drainSpy).toHaveBeenCalledTimes(2);

    state = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(drainSpy).toHaveBeenCalledTimes(3);
    expect(recoverSpy).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(30_000);
    expect(drainSpy).toHaveBeenCalledTimes(4);

    stop();
    vi.advanceTimersByTime(60_000);
    expect(drainSpy).toHaveBeenCalledTimes(4);
  });
});
