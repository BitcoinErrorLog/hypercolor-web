"use client";

import { useEffect } from "react";
import { KeyStore } from "@/services/KeyStore";
import { getEnableStatus, restoreSessionOnLoad } from "@/services/link/session";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

export function SessionBootstrap() {
  const setFromRestore = useSessionStatusStore((s) => s.setFromRestore);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await KeyStore.initKeyStore();
      const restore = await restoreSessionOnLoad();
      if (cancelled) return;
      if (restore.status === "live") {
        const homeserver = (await KeyStore.getHomeserver()) ?? "";
        useAuthStore.getState().setAuthenticated(restore.pubky, homeserver);
      }
      let enable: Awaited<ReturnType<typeof getEnableStatus>> | undefined;
      try {
        enable = await getEnableStatus();
      } catch {
        enable = undefined;
      }
      if (cancelled) return;
      setFromRestore(restore, enable);
    })();
    return () => {
      cancelled = true;
    };
  }, [setFromRestore]);

  return null;
}
