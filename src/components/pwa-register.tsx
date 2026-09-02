"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { emit } from "@/services/vibeware/collector";

type BeforeInstallPromptLike = Event & {
  userChoice?: Promise<{ outcome?: string }>;
};

export function PwaRegister() {
  const pathname = usePathname();
  const emitted = useRef(false);
  const waitingRef = useRef<ServiceWorker | null>(null);
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
            waitingRef.current?.postMessage({ type: "hypercolor-skip-waiting" });
            window.location.reload();
          }}
        >
          Reload
        </Button>
      </div>
    </div>
  );
}
