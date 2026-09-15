"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { emit } from "@/services/vibeware/collector";

type BeforeInstallPromptLike = Event & {
  userChoice?: Promise<{ outcome?: string }>;
};

export function PwaRegister() {
  const pathname = usePathname();
  const emitted = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (pathname.startsWith("/e2e")) return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js");
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

  return null;
}
