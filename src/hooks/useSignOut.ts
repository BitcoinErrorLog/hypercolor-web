"use client";

import { useState } from "react";
import { useBlockingGate } from "@/hooks/useBlockingGate";
import { clearBackupGate } from "@/lib/backup-gate";
import { clearListDetailFocus } from "@/lib/list-detail-focus";
import { LinkService } from "@/services/link/LinkService";
import { clearCohortKey } from "@/services/vibeware/cohort";
import { useChannelsStore } from "@/stores/channelsStore";
import { useContactStore } from "@/stores/contactStore";
import { useInboxStore } from "@/stores/inboxStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

function safeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function runClear(label: string, clear: () => void): void {
  try {
    clear();
  } catch (err) {
    // Storage can throw SecurityError in private mode / policy blocks.
    console.warn(`[useSignOut] ${label} failed:`, safeErrorMessage(err));
  }
}

function evictServiceWorkerCache() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage({ type: "hypercolor-sign-out" });
}

export function useSignOut() {
  const { requestPush, requestRun } = useBlockingGate();
  const reset = useSessionStatusStore((s) => s.reset);
  const [busy, setBusy] = useState(false);

  async function actuallySignOut() {
    setBusy(true);
    try {
      await LinkService.clearSession();
      // Each clear is fault-isolated so a storage throw cannot skip store
      // resets, SW eviction, or navigation after the session wipe.
      runClear("clearListDetailFocus", clearListDetailFocus);
      runClear("clearCohortKey", clearCohortKey);
      runClear("clearBackupGate", clearBackupGate);
      useInboxStore.getState().reset();
      useChannelsStore.getState().reset();
      useContactStore.setState({ contacts: {}, meshPeers: {} });
      evictServiceWorkerCache();
      reset();
      requestPush("/");
    } finally {
      setBusy(false);
    }
  }

  function signOut(): boolean {
    return requestRun(() => {
      void actuallySignOut();
    });
  }

  return { signOut, busy };
}
