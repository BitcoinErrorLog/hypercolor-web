"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AuthUrlPanel } from "@/components/auth-url-panel";
import { Button } from "@/components/ui/button";
import { useAuthUrl } from "@/hooks/useAuthUrl";
import { provisionReceiver } from "@/services/link/provisionReceiver";
import { getEnableStatus, signOut } from "@/services/link/session";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import type { SessionHandle } from "@/services/link/PaykitLinkWeb";

export function EnablePage() {
  const status = useSessionStatusStore((s) => s.status);
  const setEnabled = useSessionStatusStore((s) => s.setEnabled);
  const reset = useSessionStatusStore((s) => s.reset);
  const [error, setError] = useState<string | null>(null);
  const [provisionedPath, setProvisionedPath] = useState<string | null>(null);

  const onApproved = useCallback(
    async (session: SessionHandle) => {
      const result = await provisionReceiver(session, session.pubky());
      setProvisionedPath(result.receiverPath);
      setEnabled(result.pubky);
    },
    [setEnabled],
  );

  const auth = useAuthUrl({
    autoFetch: status.kind === "needs-enable" || status.kind === "live",
    onApproved,
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Authorization failed"),
  });

  const enabled = status.kind === "enabled";
  const offline = status.kind === "session-offline";

  return (
    <article className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Enable encrypted messaging
      </h1>
      <p className="text-muted-foreground leading-7">
        Encrypted DMs and homeserver writes share one Paykit session. Approve{" "}
        <code className="font-mono text-foreground">
          /pub/paykit/:rw,/pub/hypercolor.app/v1/:rw
        </code>{" "}
        in Pubky Ring. Hypercolor never holds your identity secret.
      </p>

      <div className="rounded-md border border-border bg-card p-4 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Status
        </p>
        <p data-testid="enableMessagingStatus" className="mt-1">
          {enabled
            ? "Encrypted messaging enabled"
            : offline
              ? "Session offline"
              : auth.isLoading
                ? "Checking messaging status…"
                : auth.isExpired
                  ? "Authorization expired"
                  : "Waiting for Pubky Ring…"}
        </p>
        {status.kind === "enabled" || status.kind === "live" || status.kind === "session-offline" ? (
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
            {status.pubky}
          </p>
        ) : null}
        {provisionedPath ? (
          <p className="mt-2 text-muted-foreground">
            Receiver path {provisionedPath}
          </p>
        ) : null}
      </div>

      {enabled ? (
        <p className="text-sm text-muted-foreground">
          Ring approved the grant and this device published a receiver marker.{" "}
          <Link href="/chats" className="underline underline-offset-4">
            Open chats
          </Link>
        </p>
      ) : null}

      {auth.isExpired ? (
        <Button type="button" onClick={() => void auth.fetchUrl()}>
          Generate new authorization
        </Button>
      ) : null}

      {!enabled && !auth.isExpired ? (
        <AuthUrlPanel
          url={auth.url}
          title="Authorization URL"
          hint="Scan with Pubky Ring on this or another device."
          copyLabel="Copy authorization URL"
          openLabel="Open Pubky Ring"
          testIdPrefix="enableMessaging"
        />
      ) : null}

      {offline ? (
        <Button
          type="button"
          onClick={() => {
            void getEnableStatus();
            void auth.fetchUrl();
          }}
        >
          Try again
        </Button>
      ) : null}

      {enabled ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void signOut().then(() => {
              reset();
              void auth.fetchUrl();
            });
          }}
        >
          Sign out
        </Button>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </article>
  );
}
