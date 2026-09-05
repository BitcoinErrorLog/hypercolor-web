"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ErrorDetails } from "@/components/error-details";
import { TruncatedPubky } from "@/components/truncated-pubky";
import { CUSTODY_LINE } from "@/lib/session-ui";
import { resolveWelcomePhase, type WelcomePhase } from "@/components/welcome-phase";
import { formatRingVerificationCode } from "@/services/ringChannelId";

export type { WelcomePhase };
export { resolveWelcomePhase };

export function WelcomePage({
  appName,
  isAuthenticated,
  pubky,
  isLoading,
  isExpired,
  error,
  pendingPubky,
  adopting,
  authPanel,
  linkLive,
  finishing = false,
  phase: phaseProp,
  ch = "",
  onGenerateLink,
  onConfirmAdoption,
  onCancelAdoption,
  onCancelWaiting,
  onTryAgain,
  onShowQrAgain,
  onRetryPublish,
}: {
  appName: string;
  isAuthenticated: boolean;
  pubky: string | null;
  isLoading: boolean;
  isExpired: boolean;
  error: string | null;
  pendingPubky: string | null;
  adopting: boolean;
  authPanel: ReactNode;
  linkLive: boolean;
  finishing?: boolean;
  phase?: WelcomePhase;
  ch?: string;
  onGenerateLink: () => void;
  onConfirmAdoption: () => void;
  onCancelAdoption: () => void;
  onCancelWaiting: () => void;
  onTryAgain?: () => void;
  onShowQrAgain?: () => void;
  onRetryPublish?: () => void;
}) {
  const phase = resolveWelcomePhase({
    isExpired,
    error,
    pendingPubky,
    linkLive,
    finishing,
    phase: phaseProp,
  });
  const showQr = phase === "waiting";
  const retry = onTryAgain ?? onGenerateLink;
  const verificationCode = ch ? formatRingVerificationCode(ch) : "";

  return (
    <article className="space-y-6" data-surface="welcome-page">
      <h1 className="text-3xl font-semibold tracking-tight">{appName}</h1>
      <p className="text-muted-foreground leading-7">{CUSTODY_LINE}</p>
      <p className="text-muted-foreground leading-7">
        Approve once in Pubky Ring to sign this device in and set up messaging keys.
      </p>

      {isAuthenticated && pubky ? (
        <p className="text-sm text-muted-foreground">
          Signed in as <TruncatedPubky pubky={pubky} />.{" "}
          <Link href="/enable" className="underline underline-offset-4">
            Enable encrypted messaging
          </Link>
        </p>
      ) : phase === "idle" ? (
        <Button
          type="button"
          data-testid="welcomeConnect"
          disabled={isLoading}
          onClick={onGenerateLink}
        >
          Connect with Pubky Ring
        </Button>
      ) : null}

      {phase === "idle" && isLoading ? (
        <p className="text-sm text-muted-foreground">Preparing paykit-connect…</p>
      ) : null}

      {phase === "expired" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This paykit-connect link expired. Generate a new one.
          </p>
          <Button type="button" data-testid="welcomeGenerate" onClick={onGenerateLink}>
            Generate new link
          </Button>
        </div>
      ) : null}

      {showQr ? authPanel : null}

      {showQr && verificationCode ? (
        <div className="space-y-1" data-testid="welcomeVerification">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Verification code
          </p>
          <p
            className="font-mono text-sm tracking-wide text-foreground"
            data-testid="welcomeVerificationCode"
          >
            {verificationCode}
          </p>
          <p className="text-sm text-muted-foreground">
            Pubky Ring shows the same code before you approve.
          </p>
        </div>
      ) : null}

      {phase === "waiting" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Waiting for Pubky Ring… Approve the request in Pubky Ring, or scan the code on another
            device.
          </p>
          <Button
            type="button"
            variant="outline"
            data-testid="welcomeCancel"
            onClick={onCancelWaiting}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {phase === "finishing" ? (
        <div
          className="space-y-3 rounded-md border border-border bg-card p-4"
          data-testid="welcomeFinishing"
          role="status"
        >
          <div className="flex items-center gap-3">
            <span
              className="inline-block size-5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">Finishing sign-in…</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onShowQrAgain ? (
              <Button
                type="button"
                variant="outline"
                data-testid="welcomeShowQrAgain"
                onClick={onShowQrAgain}
              >
                Show QR again
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              data-testid="welcomeCancel"
              onClick={onCancelWaiting}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "ready" && pendingPubky ? (
        <div
          className="space-y-3 rounded-md border border-border bg-card p-4"
          data-testid="welcomeAdopt"
        >
          <p className="text-sm leading-6">
            Continue as <TruncatedPubky pubky={pendingPubky} />?
          </p>
          <div className="flex gap-2">
            <Button type="button" disabled={adopting} onClick={onConfirmAdoption}>
              Continue
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={adopting}
              onClick={onCancelAdoption}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "legacy" ? (
        <div className="space-y-3" data-testid="welcomeLegacy">
          <p className="text-sm text-muted-foreground">
            Update Pubky Ring, or approve once more
          </p>
          {authPanel}
          <Button
            type="button"
            variant="outline"
            data-testid="welcomeCancel"
            onClick={onCancelWaiting}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {phase === "retry-publish" ? (
        <div className="w-full space-y-3" data-testid="welcomeRetryPublish">
          <p className="text-sm text-muted-foreground">
            Sign-in finished, but publishing the receiver failed.
          </p>
          {onRetryPublish ? (
            <Button type="button" data-testid="welcomeRetryPublish" onClick={onRetryPublish}>
              Retry publish
            </Button>
          ) : null}
        </div>
      ) : null}

      {phase === "failed" ? (
        <div className="w-full space-y-3" data-testid="welcomeFailed">
          <ErrorDetails
            fallback={error || "Could not finish sign-in."}
            details={null}
            onRetry={retry}
            retryLabel="Try again"
          />
          {onShowQrAgain ? (
            <Button
              type="button"
              variant="outline"
              data-testid="welcomeShowQrAgain"
              onClick={onShowQrAgain}
            >
              Show QR again
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
