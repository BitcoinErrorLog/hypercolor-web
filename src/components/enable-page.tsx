"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

export function EnablePage({
  enabled: enabledProp,
  offline,
  isLoading,
  isExpired,
  error,
  identityLabel,
  provisionedPath,
  authPanel,
  onRegenerate,
  onRetry,
  onSignOut,
  onOpenChats,
  showOpenChats,
}: {
  enabled: boolean;
  offline: boolean;
  isLoading: boolean;
  isExpired: boolean;
  error: string | null;
  identityLabel: string | null;
  provisionedPath: string | null;
  authPanel: ReactNode;
  onRegenerate: () => void;
  onRetry: () => void;
  onSignOut: () => void;
  onOpenChats: () => void;
  showOpenChats: boolean;
}) {
  const storeKind = useSessionStatusStore((s) => s.status.kind);
  const enabled = storeKind === "enabled" || enabledProp;
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
        <p
          data-testid="enableMessagingStatus"
          data-hc-store-kind={storeKind}
          className="mt-1"
        >
          {enabled
            ? "Encrypted messaging enabled"
            : error
              ? error
              : offline
                ? "Session offline"
                : isLoading
                  ? "Checking messaging status…"
                  : isExpired
                    ? "Authorization expired"
                    : "Waiting for Pubky Ring…"}
        </p>
        {identityLabel ? (
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
            {identityLabel}
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
          Ring approved the grant and this device published a receiver marker.
          {showOpenChats ? (
            <Button
              type="button"
              className="mt-3"
              data-testid="enableOpenChats"
              onClick={onOpenChats}
            >
              Open chats
            </Button>
          ) : null}
        </p>
      ) : null}

      {isExpired ? (
        <Button type="button" onClick={onRegenerate}>
          Generate new authorization
        </Button>
      ) : null}

      {authPanel}

      {offline ? (
        <Button type="button" onClick={onRetry}>
          Try again
        </Button>
      ) : null}

      {enabled ? (
        <Button type="button" variant="outline" onClick={onSignOut}>
          Sign out
        </Button>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </article>
  );
}
