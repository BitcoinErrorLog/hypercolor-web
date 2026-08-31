"use client";

import { useEffect } from "react";
import { KeyStore } from "@/services/KeyStore";
import { startLinkRetryDrainOnVisibility } from "@/services/link/LinkService";
import { warmPaykitClient } from "@/services/link/PaykitLinkWeb";
import {
  getEnableStatus,
  getLastRestoreDebug,
  readSessionMetadata,
  restoreSessionOnLoad,
} from "@/services/link/session";
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
      try {
        if (typeof document !== "undefined") {
          document.documentElement.dataset.hcEnable = "pending";
        }
        await KeyStore.initKeyStore();
        try {
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
        // Re-read at apply time so a slow first restore cannot overwrite
        // Enable/Welcome progress with the snapshot from page load.
        const restoreNow = await restoreSessionOnLoad();
        if (runId !== bootstrapRun) return;
        let enableNow = enable;
        try {
          enableNow = await getEnableStatus();
        } catch {
          enableNow = enable;
        }
        if (runId !== bootstrapRun) return;
        const pubky = useAuthStore.getState().pubky ?? (await KeyStore.getPubky());
        const hasIdentity =
          hadIdentity ||
          Boolean(pubky) ||
          restoreNow.status === "live" ||
          restoreNow.status === "session-offline";
        setFromRestore(restoreNow, enableNow, { hasIdentity });
        if (typeof document !== "undefined") {
          document.documentElement.dataset.hcRestore = restoreNow.status;
          document.documentElement.dataset.hcEnable = enableNow ?? "";
          document.documentElement.dataset.hcNote = getLastRestoreDebug();
          document.documentElement.dataset.hcIdentity = hasIdentity ? "1" : "0";
          void readSessionMetadata().then((meta) => {
            document.documentElement.dataset.hcMeta = meta ? "1" : "0";
          });
        }
        if (enableNow === "enabled") {
          stopDrain = startLinkRetryDrainOnVisibility();
        }
      } catch {
        if (runId !== bootstrapRun) return;
        if (typeof document !== "undefined") {
          document.documentElement.dataset.hcRestore = "error";
          document.documentElement.dataset.hcEnable = "error";
        }
      }
    })();
    return () => {
      bootstrapRun += 1;
      stopDrain?.();
    };
  }, [setFromRestore]);

  return null;
}
