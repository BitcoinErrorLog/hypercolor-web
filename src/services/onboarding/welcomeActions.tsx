"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AuthUrlActions } from "@/components/auth-url-actions";
import { AuthUrlPanel } from "@/components/auth-url-panel";
import { WelcomePage } from "@/components/welcome-page";
import { resolveWelcomePhase } from "@/components/welcome-phase";
import { usePaykitConnect } from "@/hooks/usePaykitConnect";
import { RING_GRANT_CAPABILITIES } from "@/types/link";
import { APP_NAME } from "@/lib/app-meta";
import { sanitizeHandoffError, type HandoffPayload, type HandoffPublicParams } from "@/services/RingConnect";
import { PaykitLinkWeb, type SessionHandle } from "@/services/link/PaykitLinkWeb";
import { getLivePaykitConnect } from "@/services/paykitConnectLive";
import { provisionReceiver } from "@/services/link/provisionReceiver";
import {
  BindingMismatchError,
  ProvisionReceiverFailedError,
  finishLegacyChainedGrant,
  finishSingleApproval,
  type CombinedWatchResult,
} from "@/services/singleApproval";
import { emit } from "@/services/vibeware/collector";
import { emitCoarseError, onboardingStateFromKind } from "@/services/vibeware/coarse";
import { useLeaveOnce } from "@/services/vibeware/leave";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

function buildAuthPanel(url: string, title: string): ReactNode {
  return (
    <AuthUrlPanel
      url={url}
      title={title}
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

/** Sign out only the tracked approval session, never the global live cookie. */
export function welcomeFlowErrorSignOutTarget() {
  return getLivePaykitConnect()?.authFlow.session ?? null;
}

export function WelcomePageHost() {
  const router = useRouter();
  const pubky = useAuthStore((s) => s.pubky);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const status = useSessionStatusStore((s) => s.status);
  const setEnabled = useSessionStatusStore((s) => s.setEnabled);
  const adopted = useRef(false);
  const cancelled = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [legacy, setLegacy] = useState<{
    params: HandoffPublicParams;
    payload: HandoffPayload;
    ch: string;
    authUrl: string;
  } | null>(null);
  const [retryPublish, setRetryPublish] = useState<string | null>(null);
  const legacyCanceled = useRef(false);

  const goToChats = useCallback(
    (nextPubky: string) => {
      adopted.current = true;
      setEnabled(nextPubky);
      router.push("/chats");
    },
    [router, setEnabled],
  );

  const onResult = useCallback(
    async (result: CombinedWatchResult) => {
      setFinishing(false);
      if (result.kind === "aborted") return;
      if (result.kind === "timeout") {
        return;
      }
      if (result.kind === "auth_missing") {
        setError("Sign-in did not finish. Show the QR again.");
        return;
      }
      if (result.kind === "locator_missing") {
        try {
          await PaykitLinkWeb.signOutSession(result.session);
        } catch {
          try {
            result.session.free();
          } catch {
            // already consumed
          }
        }
        setError("Sign-in did not finish. Show the QR again.");
        return;
      }
      if (result.kind === "legacy") {
        setFinishing(false);
        try {
          const flow = await PaykitLinkWeb.startAuthFlow(RING_GRANT_CAPABILITIES);
          const tracked = { handle: flow, canceled: false };
          legacyCanceled.current = false;
          setLegacy({
            params: result.params,
            payload: result.payload,
            ch: result.ch,
            authUrl: flow.authorizationUrl(),
          });
          void PaykitLinkWeb.awaitAuthApproval(flow)
            .then(async (session: SessionHandle) => {
              if (tracked.canceled || legacyCanceled.current) {
                try {
                  await PaykitLinkWeb.signOutSession(session);
                } catch {
                  try {
                    session.free();
                  } catch {
                    // consumed
                  }
                }
                return;
              }
              try {
                const done = await finishLegacyChainedGrant({
                  params: result.params,
                  payload: result.payload,
                  session,
                  ch: result.ch,
                });
                goToChats(done.pubky);
              } catch (err) {
                if (err instanceof ProvisionReceiverFailedError) {
                  setRetryPublish(result.params.pubky);
                  setLegacy(null);
                  setError("Could not publish the receiver. Retry publish.");
                  return;
                }
                if (err instanceof BindingMismatchError) {
                  setError("Sign-in did not finish. Show the QR again.");
                  setLegacy(null);
                  emitCoarseError("welcome", err);
                  return;
                }
                throw err;
              }
            })
            .catch((err: unknown) => {
              if (tracked.canceled || legacyCanceled.current) return;
              setError(sanitizeHandoffError(err));
              emitCoarseError("welcome", err);
            });
        } catch (err) {
          setError(sanitizeHandoffError(err));
          emitCoarseError("welcome", err);
        }
        return;
      }

      setFinishing(true);
      try {
        const done = await finishSingleApproval({
          params: result.params,
          payload: result.payload,
          session: result.session,
          ch: result.ch,
        });
        goToChats(done.pubky);
      } catch (err) {
        setFinishing(false);
        if (err instanceof ProvisionReceiverFailedError) {
          setRetryPublish(result.params.pubky);
          setError("Could not publish the receiver. Retry publish.");
          return;
        }
        if (err instanceof BindingMismatchError) {
          setError("Sign-in did not finish. Show the QR again.");
          emitCoarseError("welcome", err);
          return;
        }
        setError(sanitizeHandoffError(err));
        emitCoarseError("welcome", err);
      }
    },
    [goToChats],
  );

  const connect = usePaykitConnect({
    autoStart: !isAuthenticated,
    onResult,
    onProgress: () => {
      setFinishing(true);
      setError(null);
    },
    onError: (err, flowSession) => {
      setFinishing(false);
      if (flowSession) {
        void PaykitLinkWeb.signOutSession(flowSession).catch(() => undefined);
      }
      setError(sanitizeHandoffError(err));
      emitCoarseError("welcome", err);
    },
  });

  const phase = resolveWelcomePhase({
    isExpired: connect.isExpired && !error && !retryPublish && !legacy,
    error,
    pendingPubky: null,
    linkLive: Boolean(connect.url) && !connect.isExpired && !finishing && !error && !legacy && !retryPublish,
    finishing: finishing && !legacy && !retryPublish,
    legacyRecovery: Boolean(legacy),
    retryPublish: Boolean(retryPublish),
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

  function mintNewLink() {
    setError(null);
    setFinishing(false);
    setLegacy(null);
    setRetryPublish(null);
    void connect.start({ replace: true });
  }

  function showQrAgain() {
    setError(null);
    setFinishing(false);
    setLegacy(null);
    setRetryPublish(null);
    void connect.showQrAgain();
  }

  return (
    <WelcomePage
      appName={APP_NAME}
      isAuthenticated={isAuthenticated}
      pubky={pubky}
      isLoading={connect.isLoading}
      isExpired={connect.isExpired && !error && !retryPublish}
      error={error}
      pendingPubky={null}
      adopting={false}
      finishing={finishing}
      phase={phase}
      authPanel={
        phase === "waiting"
          ? buildAuthPanel(connect.url, "Paykit-connect link")
          : phase === "legacy"
            ? buildAuthPanel(legacy?.authUrl ?? "", "Authorization URL")
            : null
      }
      linkLive={phase === "waiting"}
      ch={connect.ch}
      onGenerateLink={() => {
        if (phase === "waiting") return;
        mintNewLink();
      }}
      onTryAgain={mintNewLink}
      onShowQrAgain={showQrAgain}
      onReloadPage={() => window.location.reload()}
      onConfirmAdoption={() => undefined}
      onCancelAdoption={() => undefined}
      onRetryPublish={
        retryPublish
          ? () => {
              void (async () => {
                const { getLiveSession } = await import("@/services/link/session");
                const session = getLiveSession();
                if (!session) {
                  setError("Sign-in did not finish. Show the QR again.");
                  return;
                }
                try {
                  await provisionReceiver(session.handle, session.pubky);
                  goToChats(session.pubky);
                } catch (err) {
                  setError(sanitizeHandoffError(err));
                }
              })();
            }
          : undefined
      }
      onCancelWaiting={() => {
        cancelled.current = true;
        legacyCanceled.current = true;
        connect.cancel();
        setError(null);
        setLegacy(null);
        setFinishing(false);
        setRetryPublish(null);
      }}
    />
  );
}
