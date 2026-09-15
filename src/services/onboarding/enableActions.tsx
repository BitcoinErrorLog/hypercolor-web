"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AuthUrlActions } from "@/components/auth-url-actions";
import { AuthUrlPanel } from "@/components/auth-url-panel";
import { EnablePage } from "@/components/enable-page";
import { useAuthUrl } from "@/hooks/useAuthUrl";
import { provisionReceiver } from "@/services/link/provisionReceiver";
import { getEnableStatus, signOut } from "@/services/link/session";
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
      hint="Scan with Pubky Ring on this or another device."
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
  const status = useSessionStatusStore((s) => s.status);
  const setEnabled = useSessionStatusStore((s) => s.setEnabled);
  const reset = useSessionStatusStore((s) => s.reset);
  const [error, setError] = useState<string | null>(null);
  const [provisionedPath, setProvisionedPath] = useState<string | null>(null);

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

  const enabled = status.kind === "enabled";
  const offline = status.kind === "session-offline";
  const identityLabel =
    status.kind === "enabled" || status.kind === "live" || status.kind === "session-offline"
      ? status.pubky
      : null;

  return (
    <EnablePage
      enabled={enabled}
      offline={offline}
      isLoading={auth.isLoading}
      isExpired={auth.isExpired}
      error={error}
      identityLabel={identityLabel}
      provisionedPath={provisionedPath}
      authPanel={!enabled && !auth.isExpired ? buildAuthPanel(auth.url) : null}
      onRegenerate={() => void auth.fetchUrl()}
      onRetry={() => {
        void getEnableStatus();
        void auth.fetchUrl();
      }}
      onSignOut={() => {
        void signOut().then(() => {
          reset();
          void auth.fetchUrl();
        });
      }}
    />
  );
}
