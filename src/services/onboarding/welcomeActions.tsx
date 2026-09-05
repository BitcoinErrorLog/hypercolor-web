"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AuthUrlActions } from "@/components/auth-url-actions";
import { AuthUrlPanel } from "@/components/auth-url-panel";
import { WelcomePage } from "@/components/welcome-page";
import { resolveWelcomePhase } from "@/components/welcome-phase";
import { usePaykitConnect } from "@/hooks/usePaykitConnect";
import { APP_NAME } from "@/lib/app-meta";
import {
  adoptHandoff,
  decryptPendingHandoff,
  sanitizeHandoffError,
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
  const [finishing, setFinishing] = useState(false);
  const [pending, setPending] = useState<{
    params: HandoffPublicParams;
    payload: HandoffPayload;
    ch: string;
  } | null>(null);
  const [adopting, setAdopting] = useState(false);

  const onParams = useCallback(async (params: HandoffPublicParams, ch: string) => {
    setFinishing(true);
    setError(null);
    try {
      const payload = await decryptPendingHandoff(params, ch);
      setPending({ params, payload, ch });
      setFinishing(false);
    } catch (err) {
      setFinishing(false);
      setError(sanitizeHandoffError(err));
      emitCoarseError("welcome", err);
    }
  }, []);

  const connect = usePaykitConnect({
    autoStart: !isAuthenticated,
    onParams,
    onError: (err) => {
      setFinishing(false);
      setError(sanitizeHandoffError(err));
      emitCoarseError("welcome", err);
    },
  });

  const phase = resolveWelcomePhase({
    isExpired: connect.isExpired,
    error,
    pendingPubky: pending?.params.pubky ?? null,
    linkLive: Boolean(connect.url) && !connect.isExpired && !finishing && !pending && !error,
    finishing,
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
      const result = await adoptHandoff(pending.params, pending.payload, pending.ch);
      if (result) {
        adopted.current = true;
        setNeedsEnable();
        router.push("/enable");
      }
    } catch (err) {
      setError(sanitizeHandoffError(err));
      emitCoarseError("welcome", err);
    } finally {
      setAdopting(false);
    }
  }

  function mintNewLink() {
    setError(null);
    setPending(null);
    setFinishing(false);
    void connect.start({ replace: true });
  }

  function showQrAgain() {
    setError(null);
    setPending(null);
    setFinishing(false);
    void connect.showQrAgain();
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
      finishing={finishing}
      phase={phase}
      authPanel={phase === "waiting" ? buildAuthPanel(connect.url) : null}
      linkLive={phase === "waiting"}
      ch={connect.ch}
      onGenerateLink={() => {
        if (phase === "waiting") return;
        mintNewLink();
      }}
      onTryAgain={mintNewLink}
      onShowQrAgain={showQrAgain}
      onConfirmAdoption={() => void confirmAdoption(true)}
      onCancelAdoption={() => void confirmAdoption(false)}
      onCancelWaiting={() => {
        cancelled.current = true;
        connect.cancel();
        setError(null);
        setPending(null);
        setFinishing(false);
      }}
    />
  );
}
