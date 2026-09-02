import { afterEach, describe, expect, it } from "vitest";
import {
  prefersReducedMotion,
  REDUCED_MOTION_QUERY,
  scriptedMotionMs,
  scriptedScrollBehavior,
} from "./reduced-motion";

describe("reduced-motion", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("is false when matchMedia is unavailable", () => {
    expect(prefersReducedMotion()).toBe(false);
    expect(scriptedScrollBehavior()).toBe("smooth");
    expect(scriptedMotionMs(150)).toBe(150);
  });

  it("reads matchMedia(prefers-reduced-motion: reduce)", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        matchMedia: (query: string) => ({
          matches: query === REDUCED_MOTION_QUERY,
        }),
      },
    });
    expect(REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
    expect(prefersReducedMotion()).toBe(true);
    expect(scriptedScrollBehavior()).toBe("auto");
    expect(scriptedMotionMs(150)).toBe(0);
  });

  it("keeps scripted motion when the user has not requested a reduction", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        matchMedia: () => ({ matches: false }),
      },
    });
    expect(prefersReducedMotion()).toBe(false);
    expect(scriptedScrollBehavior()).toBe("smooth");
    expect(scriptedMotionMs(150)).toBe(150);
  });
});
