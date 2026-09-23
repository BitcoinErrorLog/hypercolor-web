"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AuthUrlActions } from "@/components/auth-url-actions";
import { AuthUrlPanel } from "@/components/auth-url-panel";
import { EnablePage } from "@/components/enable-page";
import { useAuthUrl } from "@/hooks/useAuthUrl";
import { useGuardedRouter } from "@/hooks/useBlockingGate";
import { retrySessionRestore } from "@/lib/session-retry";
import { KeyStore } from "@/services/KeyStore";
import { provisionReceiver } from "@/services/link/provisionReceiver";
import { getEnableStatus } from "@/services/link/session";
import { emit } from "@/services/vibeware/collector";
import { emitCoarseError, onboardingStateFromKind } from "@/services/vibeware/coarse";
import { useLeaveOnce } from "@/services/vibeware/leave";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import type { SessionHandle } from "@/services/link/PaykitLinkWeb";

function buildAuthPanel(url: string): ReactNode {
  return (
    <AuthUrlPanel
      url={url}
      title="Authorization URL"
      hint="Approve the request in Pubky Ring, or scan the code on another device."
      testIdPrefix="enableMessaging"
      actions={
        <AuthUrlActions
          url={url}
          copyLabel="Copy authorization URL"
          openLabel="Open Pubky Ring"
          testIdPrefix="enableMessaging"
        />
      }
    />
  );
}

export function EnablePageHost() {
  const router = useGuardedRouter();
  const status = useSessionStatusStore((s) => s.status);
  const setEnabled = useSessionStatusStore((s) => s.setEnabled);
  const [error, setError] = useState<string | null>(null);
  const [provisionedPath, setProvisionedPath] = useState<string | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);

  const onApproved = useCallback(
    async (session: SessionHandle) => {
      try {
        const result = await provisionReceiver(session, session.pubky());
        setError(null);
        setProvisionedPath(result.receiverPath);
        setEnabled(result.pubky);
      } catch (err) {
        // Ring approved the grant but publishing the receiver marker failed.
        // Without this the status line sits on "Waiting for Pubky Ring…".
        setError(err instanceof Error ? err.message : "Authorization failed");
        emitCoarseError("enable", err);
      }
    },
    [setEnabled],
  );

  const auth = useAuthUrl({
    autoFetch: status.kind === "needs-enable" || status.kind === "live",
    onApproved,
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Authorization failed");
      emitCoarseError("enable", err);
    },
  });

  useEffect(() => {
    const state = onboardingStateFromKind(status.kind);
    if (!state) return;
    void emit("app.onboarding.state", { state });
  }, [status.kind]);

  useLeaveOnce(
    "enable",
    () => status.kind === "needs-enable" || status.kind === "live",
    () => {
      void emit("app.onboarding.abandoned", { step: "enable" });
    },
  );

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        const enable = await getEnableStatus();
        const pubky =
          (status.kind === "enabled" ||
          status.kind === "live" ||
          status.kind === "session-offline"
            ? status.pubky
            : null) ?? (await KeyStore.getPubky());
        if (enable === "enabled" && pubky) {
          setEnabled(pubky);
        }
      })();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [status, setEnabled]);

  const enabled = status.kind === "enabled";
  const offline = status.kind === "session-offline";
  const denied = Boolean(error && /denied|declined|not grant/i.test(error));
  const identityLabel =
    status.kind === "enabled" || status.kind === "live" || status.kind === "session-offline"
      ? status.pubky
      : null;

  function leave() {
    router.push("/chats");
  }

  return (
    <EnablePage
      enabled={enabled}
      offline={offline}
      isLoading={auth.isLoading && !enabled}
      isExpired={auth.isExpired}
      denied={denied}
      error={error}
      identityLabel={identityLabel}
      provisionedPath={provisionedPath}
      authPanel={!enabled && !auth.isExpired && !denied ? buildAuthPanel(auth.url) : null}
      onRegenerate={() => void auth.fetchUrl()}
      retryBusy={retryBusy}
      onRetry={() => {
        if (retryBusy) return;
        setRetryBusy(true);
        setError(null);
        const work = offline
          ? retrySessionRestore()
          : auth.fetchUrl();
        void Promise.resolve(work).finally(() => setRetryBusy(false));
      }}
      onOpenChats={() => {
        router.replace("/chats");
      }}
      onDone={() => {
        router.back();
      }}
      onNotNow={leave}
      onCancel={leave}
    />
  );
}
