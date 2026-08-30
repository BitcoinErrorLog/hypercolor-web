"use client";

import { useEffect } from "react";
import { KeyStore } from "@/services/KeyStore";
import { startLinkRetryDrainOnVisibility } from "@/services/link/LinkService";
import { getEnableStatus, restoreSessionOnLoad } from "@/services/link/session";
import { hydratePersistedAuth } from "@/stores/hydrateAuthSession";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

export function SessionBootstrap() {
  const setFromRestore = useSessionStatusStore((s) => s.setFromRestore);

  useEffect(() => {
    let cancelled = false;
    let stopDrain: (() => void) | undefined;
    void (async () => {
      await KeyStore.initKeyStore();
      const hadIdentity = await hydratePersistedAuth();
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
      const pubky = useAuthStore.getState().pubky ?? (await KeyStore.getPubky());
      const hasIdentity =
        hadIdentity ||
        Boolean(pubky) ||
        restore.status === "live" ||
        restore.status === "session-offline";
      setFromRestore(restore, enable, { hasIdentity });
      if (enable === "enabled") {
        stopDrain = startLinkRetryDrainOnVisibility();
      }
    })();
    return () => {
      cancelled = true;
      stopDrain?.();
    };
  }, [setFromRestore]);

  return null;
}
