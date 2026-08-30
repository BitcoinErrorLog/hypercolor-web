"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { AuthUrlActions } from "@/components/auth-url-actions";
import { AuthUrlPanel } from "@/components/auth-url-panel";
import { WelcomePage } from "@/components/welcome-page";
import { usePaykitConnect } from "@/hooks/usePaykitConnect";
import { APP_NAME } from "@/lib/app-meta";
import {
  adoptHandoff,
  decryptPendingHandoff,
  type HandoffPayload,
  type HandoffPublicParams,
} from "@/services/RingConnect";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

function buildAuthPanel(url: string): ReactNode {
  return (
    <AuthUrlPanel
      url={url}
      title="Paykit-connect link"
      hint="Scan with Pubky Ring on this or another device."
      testIdPrefix="welcome"
      actions={
        <AuthUrlActions
          url={url}
          copyLabel="Copy URL"
          openLabel="Open Pubky Ring"
          testIdPrefix="welcome"
        />
      }
    />
  );
}

export function WelcomePageHost() {
  const router = useRouter();
  const pubky = useAuthStore((s) => s.pubky);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setNeedsEnable = useSessionStatusStore((s) => s.setNeedsEnable);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    params: HandoffPublicParams;
    payload: HandoffPayload;
  } | null>(null);
  const [adopting, setAdopting] = useState(false);

  const onParams = useCallback(async (params: HandoffPublicParams) => {
    try {
      const payload = await decryptPendingHandoff(params);
      setPending({ params, payload });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Handoff failed");
    }
  }, []);

  const connect = usePaykitConnect({
    autoStart: !isAuthenticated,
    onParams,
    onError: (err) =>
      setError(err instanceof Error ? err.message : "paykit-connect failed"),
  });

  async function confirmAdoption(accepted: boolean) {
    if (!pending) return;
    if (!accepted) {
      setPending(null);
      return;
    }
    setAdopting(true);
    try {
      const result = await adoptHandoff(pending.params, pending.payload);
      if (result) {
        setNeedsEnable();
        router.push("/enable");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Handoff failed");
    } finally {
      setAdopting(false);
    }
  }

  return (
    <WelcomePage
      appName={APP_NAME}
      isAuthenticated={isAuthenticated}
      pubky={pubky}
      isLoading={connect.isLoading}
      isExpired={connect.isExpired}
      error={error}
      pendingPubky={pending?.params.pubky ?? null}
      adopting={adopting}
      authPanel={!connect.isExpired ? buildAuthPanel(connect.url) : null}
      onGenerateLink={() => void connect.start()}
      onConfirmAdoption={() => void confirmAdoption(true)}
      onCancelAdoption={() => void confirmAdoption(false)}
    />
  );
}
