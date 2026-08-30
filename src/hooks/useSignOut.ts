"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LinkService } from "@/services/link/LinkService";
import { useContactStore } from "@/stores/contactStore";
import { useInboxStore } from "@/stores/inboxStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

function evictServiceWorkerCache() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage({ type: "hypercolor-sign-out" });
}

export function useSignOut() {
  const router = useRouter();
  const reset = useSessionStatusStore((s) => s.reset);
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await LinkService.clearSession();
      useInboxStore.getState().reset();
      useContactStore.setState({ contacts: {}, meshPeers: {} });
      evictServiceWorkerCache();
      reset();
      router.push("/");
    } finally {
      setBusy(false);
    }
  }

  return { signOut, busy };
}
