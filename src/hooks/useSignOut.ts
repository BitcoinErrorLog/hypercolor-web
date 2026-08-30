"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LinkService } from "@/services/link/LinkService";
import { useInboxStore } from "@/stores/inboxStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

export function useSignOut() {
  const router = useRouter();
  const reset = useSessionStatusStore((s) => s.reset);
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await LinkService.clearSession();
      useInboxStore.getState().reset();
      reset();
      router.push("/");
    } finally {
      setBusy(false);
    }
  }

  return { signOut, busy };
}
