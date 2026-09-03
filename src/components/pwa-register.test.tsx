/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTROLLER_CHANGE_RELOAD_TIMEOUT_MS,
  armControllerChangeReload,
} from "@/components/pwa-register";

describe("armControllerChangeReload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeServiceWorker() {
    const listeners = new Map<string, Set<EventListener>>();
    const serviceWorker = {
      addEventListener: (type: string, listener: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener: (type: string, listener: EventListener) => {
        listeners.get(type)?.delete(listener);
      },
      dispatch(type: string) {
        for (const listener of [...(listeners.get(type) ?? [])]) {
          listener(new Event(type));
        }
      },
      listenerCount(type: string) {
        return listeners.get(type)?.size ?? 0;
      },
    };
    return serviceWorker;
  }

  it("reloads on controllerchange before the timeout", () => {
    const sw = fakeServiceWorker();
    const reload = vi.fn();
    const waiting = { postMessage: vi.fn() } as unknown as ServiceWorker;
    armControllerChangeReload({
      serviceWorker: sw as unknown as ServiceWorkerContainer,
      waiting,
      reload,
      timeoutMs: CONTROLLER_CHANGE_RELOAD_TIMEOUT_MS,
    });
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "hypercolor-skip-waiting" });
    expect(reload).not.toHaveBeenCalled();
    sw.dispatch("controllerchange");
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CONTROLLER_CHANGE_RELOAD_TIMEOUT_MS + 100);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sw.listenerCount("controllerchange")).toBe(0);
  });

  it("falls back to reload when controllerchange never fires", () => {
    const sw = fakeServiceWorker();
    const reload = vi.fn();
    const waiting = { postMessage: vi.fn() } as unknown as ServiceWorker;
    armControllerChangeReload({
      serviceWorker: sw as unknown as ServiceWorkerContainer,
      waiting,
      reload,
      timeoutMs: CONTROLLER_CHANGE_RELOAD_TIMEOUT_MS,
    });
    vi.advanceTimersByTime(CONTROLLER_CHANGE_RELOAD_TIMEOUT_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sw.listenerCount("controllerchange")).toBe(0);
  });

  it("does not accumulate listeners across re-arms", () => {
    const sw = fakeServiceWorker();
    const reload = vi.fn();
    const waiting = { postMessage: vi.fn() } as unknown as ServiceWorker;
    const cancel1 = armControllerChangeReload({
      serviceWorker: sw as unknown as ServiceWorkerContainer,
      waiting,
      reload,
    });
    expect(sw.listenerCount("controllerchange")).toBe(1);
    cancel1();
    expect(sw.listenerCount("controllerchange")).toBe(0);
    armControllerChangeReload({
      serviceWorker: sw as unknown as ServiceWorkerContainer,
      waiting,
      reload,
    });
    expect(sw.listenerCount("controllerchange")).toBe(1);
    sw.dispatch("controllerchange");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
