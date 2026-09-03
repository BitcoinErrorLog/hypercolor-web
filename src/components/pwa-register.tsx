"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { emit } from "@/services/vibeware/collector";

type BeforeInstallPromptLike = Event & {
  userChoice?: Promise<{ outcome?: string }>;
};


/** Fallback if `controllerchange` never fires (waiting worker stuck / activate rejects). */
export const CONTROLLER_CHANGE_RELOAD_TIMEOUT_MS = 3_000;

type ArmReloadOptions = {
  serviceWorker: ServiceWorkerContainer;
  waiting: ServiceWorker | null;
  reload?: () => void;
  timeoutMs?: number;
  postMessage?: (worker: ServiceWorker) => void;
};

/**
 * Arm a one-shot reload on controllerchange, with a bounded timeout fallback.
 * Re-arming cancels any prior listener/timer so clicks do not accumulate.
 * Returns a cancel function.
 */
export function armControllerChangeReload(options: ArmReloadOptions): () => void {
  const {
    serviceWorker,
    waiting,
    reload = () => {
      window.location.reload();
    },
    timeoutMs = CONTROLLER_CHANGE_RELOAD_TIMEOUT_MS,
    postMessage = (worker) => {
      worker.postMessage({ type: "hypercolor-skip-waiting" });
    },
  } = options;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    serviceWorker.removeEventListener("controllerchange", onChange);
    clearTimeout(timer);
    reload();
  };
  const onChange = () => {
    finish();
  };
  serviceWorker.addEventListener("controllerchange", onChange);
  const timer = setTimeout(finish, timeoutMs);
  if (waiting) {
    postMessage(waiting);
  } else {
    finish();
  }
  return () => {
    if (done) return;
    done = true;
    serviceWorker.removeEventListener("controllerchange", onChange);
    clearTimeout(timer);
  };
}

export function PwaRegister() {
  const pathname = usePathname();
  const emitted = useRef(false);
  const waitingRef = useRef<ServiceWorker | null>(null);
  const cancelArmRef = useRef<(() => void) | null>(null);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (pathname.startsWith("/e2e")) return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      const trackWaiting = (worker: ServiceWorker | null) => {
        if (!worker) return;
        waitingRef.current = worker;
        setUpdateReady(true);
      };
      if (registration.waiting) trackWaiting(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            trackWaiting(registration.waiting ?? installing);
          }
        });
      });
    });
  }, [pathname]);

  useEffect(() => {
    if (pathname.startsWith("/e2e")) return;
    const report = (outcome: "accepted" | "dismissed") => {
      if (emitted.current) return;
      emitted.current = true;
      void emit("app.pwa.installed", { outcome });
    };
    const onInstalled = () => report("accepted");
    const onBeforeInstall = (event: Event) => {
      const choice = (event as BeforeInstallPromptLike).userChoice;
      if (!choice) return;
      void choice.then((result) => {
        if (result.outcome === "accepted" || result.outcome === "dismissed") {
          report(result.outcome);
        }
      });
    };
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => {
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, [pathname]);

  if (!updateReady) return null;

  return (
    <div
      role="status"
      className="border-b border-border bg-card px-6 py-3 text-sm"
      data-testid="pwaUpdateBar"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
        <p>A new version is ready.</p>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            cancelArmRef.current?.();
            cancelArmRef.current = armControllerChangeReload({
              serviceWorker: navigator.serviceWorker,
              waiting: waitingRef.current,
            });
          }}
        >
          Reload
        </Button>
      </div>
    </div>
  );
}
