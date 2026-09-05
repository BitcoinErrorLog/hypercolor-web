"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DetailBackLink } from "@/components/detail-back";
import { ErrorDetails } from "@/components/error-details";
import { TruncatedPubky } from "@/components/truncated-pubky";
import {
  CUSTODY_LINE,
  RING_GRANT_DETAIL,
  SCOPE_SENTENCE,
} from "@/lib/session-ui";

export function EnablePage({
  enabled,
  offline,
  isLoading,
  isExpired,
  denied,
  error,
  identityLabel,
  provisionedPath,
  authPanel,
  onRegenerate,
  onRetry,
  onOpenChats,
  onDone,
  onNotNow,
  onCancel,
  retryBusy = false,
}: {
  enabled: boolean;
  offline: boolean;
  isLoading: boolean;
  isExpired: boolean;
  denied: boolean;
  error: string | null;
  identityLabel: string | null;
  provisionedPath: string | null;
  authPanel: ReactNode;
  onRegenerate: () => void;
  onRetry: () => void;
  onOpenChats: () => void;
  onDone: () => void;
  onNotNow: () => void;
  onCancel: () => void;
  retryBusy?: boolean;
}) {
  const statusLabel = enabled
    ? "Encrypted messaging enabled"
    : denied
      ? "Authorization declined"
      : error
        ? "Could not enable encrypted messaging"
        : offline
          ? "Session offline"
          : isLoading
            ? "Checking messaging status…"
            : isExpired
              ? "Authorization expired"
              : "Waiting for Pubky Ring…";

  if (enabled) {
    return (
      <article className="flex hc-enable-panel flex-col items-center justify-center space-y-6 text-center" data-surface="enable-page">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full hc-brand-fill text-2xl"
          aria-hidden="true"
        >
          ✓
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Encrypted messaging enabled</h1>
          <p className="text-muted-foreground">
            Ring approved the grant and this device published a receiver marker.
          </p>
        </div>
        <Button type="button" className="w-full max-w-md" onClick={onOpenChats}>
          Open chats
        </Button>
        <Button type="button" variant="link" onClick={onDone}>
          Done
        </Button>
        <p className="text-sm text-muted-foreground">{CUSTODY_LINE}</p>
      </article>
    );
  }

  return (
    <article className="space-y-6" data-surface="enable-page">
      <section className="hc-hero-iridescent hc-iridescent-inset w-full rounded-xl">
        <div className="hc-hero-panel space-y-6 bg-background p-8">
      <DetailBackLink href="/chats" listLabel="Chats" always />
      <h1 className="text-2xl font-semibold tracking-tight">Enable encrypted messaging</h1>
      <p className="text-muted-foreground leading-7">{SCOPE_SENTENCE}</p>
      <p className="break-all font-mono text-sm text-muted-foreground">{RING_GRANT_DETAIL}</p>

      <div className="rounded-md border border-border bg-card p-4 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Status
        </p>
        <p data-testid="enableMessagingStatus" className="mt-1">
          {statusLabel}
        </p>
        {identityLabel ? (
          <div className="mt-2">
            <TruncatedPubky pubky={identityLabel} />
          </div>
        ) : null}
        {provisionedPath ? (
          <p className="mt-2 text-muted-foreground">Receiver path {provisionedPath}</p>
        ) : null}
      </div>

      {denied ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Pubky Ring did not grant the scopes Hypercolor asked for.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onRetry} disabled={retryBusy}>
              {retryBusy ? "Trying…" : "Try again"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {isExpired ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The paykit-connect link is only valid for five minutes.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onRegenerate}>
              Generate new authorization
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {!denied && !isExpired ? authPanel : null}

      {!enabled && !offline && !denied && !isExpired && !isLoading ? (
        <Button type="button" variant="outline" onClick={onNotNow}>
          Not now
        </Button>
      ) : null}

      {offline ? (
        <div className="space-y-3">
          <Button type="button" onClick={onRetry} disabled={retryBusy} data-testid="enableOfflineRetry">
            {retryBusy ? "Trying…" : "Try again"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : null}

      {error && !denied ? (
        <ErrorDetails fallback="Could not enable encrypted messaging." details={error} />
      ) : null}

      <p className="text-sm text-muted-foreground">{CUSTODY_LINE}</p>
        </div>
      </section>
    </article>
  );
}
