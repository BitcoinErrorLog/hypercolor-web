/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  CONTROLLER_CHANGE_RELOAD_TIMEOUT_MS,
  PwaRegister,
  armControllerChangeReload,
} from "@/components/pwa-register";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/services/vibeware/collector", () => ({
  emit: vi.fn(),
}));

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

describe("PwaRegister unmount", () => {
  let host: HTMLDivElement;
  let root: Root;
  let mounted = false;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubEnv("NODE_ENV", "production");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mounted = true;
  });

  afterEach(() => {
    if (mounted) {
      act(() => {
        root.unmount();
      });
      mounted = false;
    }
    host.remove();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  async function render(ui: ReactElement) {
    await act(async () => {
      root.render(ui);
    });
  }

  function installFakeServiceWorker() {
    const listeners = new Map<string, Set<EventListener>>();
    const waiting = { postMessage: vi.fn(), state: "installed" } as unknown as ServiceWorker;
    const registration = {
      waiting,
      installing: null,
      addEventListener: vi.fn(),
    };
    const serviceWorker = {
      controller: {} as ServiceWorker,
      register: vi.fn(async () => registration),
      addEventListener: (type: string, listener: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener: (type: string, listener: EventListener) => {
        listeners.get(type)?.delete(listener);
      },
      listenerCount(type: string) {
        return listeners.get(type)?.size ?? 0;
      },
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });
    return serviceWorker;
  }

  it("cancels an armed reload on unmount", async () => {
    const sw = installFakeServiceWorker();
    await render(<PwaRegister />);
    await act(async () => {
      await Promise.resolve();
    });
    const bar = host.querySelector('[data-testid="pwaUpdateBar"]');
    expect(bar).not.toBeNull();
    const button = host.querySelector("button");
    expect(button).not.toBeNull();
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(sw.listenerCount("controllerchange")).toBe(1);
    mounted = false;
    await act(async () => {
      root.unmount();
    });
    expect(sw.listenerCount("controllerchange")).toBe(0);
    vi.advanceTimersByTime(CONTROLLER_CHANGE_RELOAD_TIMEOUT_MS + 50);
    expect(sw.listenerCount("controllerchange")).toBe(0);
  });
});
