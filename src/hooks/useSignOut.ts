"use client";

import { useState } from "react";
import { useBlockingGate } from "@/hooks/useBlockingGate";
import { LinkService } from "@/services/link/LinkService";
import { useChannelsStore } from "@/stores/channelsStore";
import { useContactStore } from "@/stores/contactStore";
import { useInboxStore } from "@/stores/inboxStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

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
