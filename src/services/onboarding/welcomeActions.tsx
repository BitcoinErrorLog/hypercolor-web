"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AuthUrlActions } from "@/components/auth-url-actions";
import { AuthUrlPanel } from "@/components/auth-url-panel";
import { WelcomePage } from "@/components/welcome-page";
import { resolveWelcomePhase } from "@/components/welcome-phase";
import { useAuthUrl } from "@/hooks/useAuthUrl";
import { APP_NAME } from "@/lib/app-meta";
import { KeyStore } from "@/services/KeyStore";
import { PaykitLinkWeb, type SessionHandle } from "@/services/link/PaykitLinkWeb";
import { provisionReceiver } from "@/services/link/provisionReceiver";
import {
  BindingMismatchError,
  adoptApprovedSession,
} from "@/services/link/session";
import { emit } from "@/services/vibeware/collector";
import { emitCoarseError, onboardingStateFromKind } from "@/services/vibeware/coarse";
import { useLeaveOnce } from "@/services/vibeware/leave";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { ensureWriter } from "@/services/tabLock";

function buildAuthPanel(url: string): ReactNode {
  return (
    <AuthUrlPanel
      url={url}
      title="Authorization URL"
      hint="Approve the request in Pubky Ring, or scan the code on another device."
      testIdPrefix="welcome"
      actions={
        <AuthUrlActions
          url={url}
          copyLabel="Copy authorization URL"
          openLabel="Open Pubky Ring"
          testIdPrefix="welcome"
        />
      }
    />
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Authorization failed";
}

export function WelcomePageHost() {
  const router = useRouter();
  const pubky = useAuthStore((s) => s.pubky);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const status = useSessionStatusStore((s) => s.status);
  const setEnabled = useSessionStatusStore((s) => s.setEnabled);
  const adopted = useRef(false);
  const cancelled = useRef(false);
  const pendingSession = useRef<SessionHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [pendingPubky, setPendingPubky] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [retryPublish, setRetryPublish] = useState(false);

  const goToChats = useCallback(
    (nextPubky: string) => {
      adopted.current = true;
      pendingSession.current = null;
      setPendingPubky(null);
      setEnabled(nextPubky);
      router.push("/chats");
    },
    [router, setEnabled],
  );

  const finishApproved = useCallback(
    async (session: SessionHandle) => {
      setFinishing(true);
      setError(null);
      try {
        await ensureWriter();
        const live = await adoptApprovedSession(session);
        await provisionReceiver(live.handle, live.pubky);
        goToChats(live.pubky);
      } catch (err) {
        setFinishing(false);
        if (err instanceof BindingMismatchError) {
          pendingSession.current = null;
          setPendingPubky(null);
          setError(err.message);
          emitCoarseError("welcome", err);
          return;
        }
        const message = errorText(err);
        if (/publish|receiver/i.test(message)) {
          setRetryPublish(true);
          setError("Could not publish the receiver. Retry publish.");
          return;
        }
        setError(message);
        emitCoarseError("welcome", err);
      }
    },
    [goToChats],
  );

  const onApproved = useCallback(
    async (session: SessionHandle) => {
      const owner = await KeyStore.getPubky();
      const next = session.pubky();
      if (owner && owner !== next) {
        try {
          await PaykitLinkWeb.signOutSession(session);
        } catch {
          try {
            session.free();
          } catch {
            // already consumed
          }
        }
        setError("This browser is already signed in as a different Pubky.");
        return;
      }
      if (owner === next) {
        await finishApproved(session);
        return;
      }
      pendingSession.current = session;
      setPendingPubky(next);
    },
    [finishApproved],
  );

  const auth = useAuthUrl({
    autoFetch: !isAuthenticated,
    adoptOnApproval: false,
    onApproved,
    onError: (err) => {
      setFinishing(false);
      setError(errorText(err));
      emitCoarseError("welcome", err);
    },
  });

  const phase = resolveWelcomePhase({
    isExpired: auth.isExpired && !error && !retryPublish && !pendingPubky,
    error,
    pendingPubky,
    linkLive: Boolean(auth.url) && !auth.isExpired && !finishing && !error && !pendingPubky && !retryPublish,
    finishing: finishing && !retryPublish,
    retryPublish,
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
    setRetryPublish(false);
    setPendingPubky(null);
    const held = pendingSession.current;
    pendingSession.current = null;
    if (held) {
      void PaykitLinkWeb.signOutSession(held).catch(() => {
        try {
          held.free();
        } catch {
          // consumed
        }
      });
    }
    void auth.fetchUrl();
  }

  return (
    <WelcomePage
      appName={APP_NAME}
      isAuthenticated={isAuthenticated}
      pubky={pubky}
      isLoading={auth.isLoading}
      isExpired={auth.isExpired && !error && !retryPublish}
      error={error}
      pendingPubky={pendingPubky}
      adopting={adopting}
      finishing={finishing}
      phase={phase}
      authPanel={phase === "waiting" ? buildAuthPanel(auth.url) : null}
      linkLive={phase === "waiting"}
      onGenerateLink={() => {
        if (phase === "waiting") return;
        mintNewLink();
      }}
      onTryAgain={mintNewLink}
      onShowQrAgain={mintNewLink}
      onReloadPage={() => window.location.reload()}
      onConfirmAdoption={() => {
        const session = pendingSession.current;
        if (!session || adopting) return;
        setAdopting(true);
        void finishApproved(session).finally(() => setAdopting(false));
      }}
      onCancelAdoption={() => {
        const session = pendingSession.current;
        pendingSession.current = null;
        setPendingPubky(null);
        setError(null);
        if (!session) return;
        void PaykitLinkWeb.signOutSession(session).catch(() => {
          try {
            session.free();
          } catch {
            // consumed
          }
        });
      }}
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
                  await ensureWriter();
                  await provisionReceiver(session.handle, session.pubky);
                  goToChats(session.pubky);
                } catch (err) {
                  setError(errorText(err));
                }
              })();
            }
          : undefined
      }
      onCancelWaiting={() => {
        cancelled.current = true;
        auth.cancel();
        const held = pendingSession.current;
        pendingSession.current = null;
        setPendingPubky(null);
        setError(null);
        setFinishing(false);
        setRetryPublish(false);
        if (held) {
          void PaykitLinkWeb.signOutSession(held).catch(() => undefined);
        }
      }}
    />
  );
}
