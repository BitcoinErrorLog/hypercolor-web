"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { emit } from "@/services/vibeware/collector";
import { emitCoarseError, onboardingStateFromKind } from "@/services/vibeware/coarse";
import { useLeaveOnce } from "@/services/vibeware/leave";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

function buildAuthPanel(url: string): ReactNode {
  return (
    <AuthUrlPanel
      url={url}
      title="Paykit-connect link"
        hint="Approve the request in Pubky Ring, or scan the code on another device."
      testIdPrefix="welcome"
      actions={
        <AuthUrlActions
          url={url}
          copyLabel="Copy paykit-connect URL"
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
  const status = useSessionStatusStore((s) => s.status);
  const setNeedsEnable = useSessionStatusStore((s) => s.setNeedsEnable);
  const adopted = useRef(false);
  const cancelled = useRef(false);
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
      emitCoarseError("welcome", err);
    }
  }, []);

  const connect = usePaykitConnect({
    autoStart: !isAuthenticated,
    onParams,
    onError: (err) => {
      setError(err instanceof Error ? err.message : "paykit-connect failed");
      emitCoarseError("welcome", err);
    },
  });

  useEffect(() => {
    const state = onboardingStateFromKind(status.kind);
    if (!state) return;
    void emit("app.onboarding.state", { state });
  }, [status.kind]);

  useLeaveOnce(
    "welcome",
    () => !isAuthenticated && !adopted.current && !cancelled.current,
    () => {
      void emit("app.onboarding.abandoned", { step: "welcome" });
    },
  );

  async function confirmAdoption(accepted: boolean) {
    if (!pending) return;
    if (!accepted) {
      cancelled.current = true;
      setPending(null);
      void emit("app.onboarding.abandoned", { step: "welcome" });
      return;
    }
    setAdopting(true);
    try {
      const result = await adoptHandoff(pending.params, pending.payload);
      if (result) {
        adopted.current = true;
        setNeedsEnable();
        router.push("/enable");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Handoff failed");
      emitCoarseError("welcome", err);
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
      linkLive={Boolean(connect.url) && !connect.isExpired}
      onGenerateLink={() => {
        if (connect.url && !connect.isExpired) return;
        void connect.start();
      }}
      onConfirmAdoption={() => void confirmAdoption(true)}
      onCancelAdoption={() => void confirmAdoption(false)}
      onCancelWaiting={() => {
        cancelled.current = true;
        connect.cancel();
        setError(null);
        setPending(null);
      }}
    />
  );
}
