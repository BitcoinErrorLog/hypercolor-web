"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AuthUrlActions } from "@/components/auth-url-actions";
import { AuthUrlPanel } from "@/components/auth-url-panel";
import { EnablePage } from "@/components/enable-page";
import { useAuthUrl } from "@/hooks/useAuthUrl";
import { ChatsPageHost } from "@/services/chats/chatsPageHost";
import { clearChatsRequested, isChatsRequested, markChatsRequested } from "@/lib/chats-open";
import { stampAppPath } from "@/lib/path-id";
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
  "use no memo";
  const status = useSessionStatusStore((s) => s.status);
  const setEnabled = useSessionStatusStore((s) => s.setEnabled);
  const reset = useSessionStatusStore((s) => s.reset);
  const [error, setError] = useState<string | null>(null);
  const [provisionedPath, setProvisionedPath] = useState<string | null>(null);
  const [chatsOpen, setChatsOpen] = useState(isChatsRequested);
  const [chatsMounted, setChatsMounted] = useState(() => isChatsRequested());
  const chatsVisible = chatsOpen || isChatsRequested();
  const enabled = status.kind === "enabled";

  const onApproved = useCallback(
    async (session: SessionHandle) => {
      try {
        const result = await provisionReceiver(session, session.pubky());
        flushSync(() => {
          setError(null);
          setProvisionedPath(result.receiverPath);
          setEnabled(result.pubky);
        });
        setChatsMounted(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authorization failed");
        emitCoarseError("enable", err);
      }
    },
    [setEnabled],
  );

  const auth = useAuthUrl({
    autoFetch:
      !enabled && (status.kind === "needs-enable" || status.kind === "live"),
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

  const offline = status.kind === "session-offline";
  const identityLabel =
    status.kind === "enabled" || status.kind === "live" || status.kind === "session-offline"
      ? status.pubky
      : null;

  return (
    <>
      <div
        {...(chatsVisible
          ? { hidden: true, inert: true, "aria-hidden": true as const }
          : {})}
      >
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
              clearChatsRequested();
              setChatsOpen(false);
              setChatsMounted(false);
              reset();
              void auth.fetchUrl();
            });
          }}
          onOpenChats={() => {
            markChatsRequested();
            setChatsOpen(true);
            if (
              window.location.pathname !== "/chats" &&
              !window.location.pathname.startsWith("/chats/")
            ) {
              stampAppPath("/chats");
            }
          }}
          showOpenChats={!chatsVisible}
        />
      </div>
      {enabled && chatsMounted ? (
        <div
          {...(!chatsVisible
            ? { hidden: true, inert: true, "aria-hidden": true as const }
            : {})}
        >
          <ChatsPageHost />
        </div>
      ) : null}
    </>
  );
}
