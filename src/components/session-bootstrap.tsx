"use client";

import { useEffect } from "react";
import { KeyStore } from "@/services/KeyStore";
import { startLinkRetryDrainOnVisibility } from "@/services/link/LinkService";
import { warmPaykitClient } from "@/services/link/PaykitLinkWeb";
import { getEnableStatus, restoreSessionOnLoad } from "@/services/link/session";
import { StorageService } from "@/services/StorageService";
import { setReceiverRoleState } from "@/services/link/receiverRoleStore";
import { hydratePersistedAuth } from "@/stores/hydrateAuthSession";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

let bootstrapRun = 0;

export function SessionBootstrap() {
  const setFromRestore = useSessionStatusStore((s) => s.setFromRestore);

  useEffect(() => {
    let stopDrain: (() => void) | undefined;
    const runId = ++bootstrapRun;
    void (async () => {
      await KeyStore.initKeyStore();
      try {
        // Compile wasm up front so cookie resume's budget is not spent on it.
        await warmPaykitClient();
      } catch {
        // Cookie resume will load wasm; do not skip restore.
      }
      const hadIdentity = await hydratePersistedAuth();
      const restore = await restoreSessionOnLoad();
      if (runId !== bootstrapRun) return;
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
      if (runId !== bootstrapRun) return;
      const pubky = useAuthStore.getState().pubky ?? (await KeyStore.getPubky());
      const hasIdentity =
        hadIdentity ||
        Boolean(pubky) ||
        restore.status === "live" ||
        restore.status === "session-offline";
      setFromRestore(restore, enable, { hasIdentity });
      if (pubky) {
        try {
          const receiver = await StorageService.getLinkReceiver(pubky);
          setReceiverRoleState(receiver?.receiverRole ?? null);
        } catch {
          setReceiverRoleState(null);
        }
      }
      if (enable === "enabled") {
        stopDrain = startLinkRetryDrainOnVisibility();
      }
    })();
    return () => {
      // A remount must supersede the previous run, not silence both.
      bootstrapRun += 1;
      stopDrain?.();
    };
  }, [setFromRestore]);

  return null;
}
