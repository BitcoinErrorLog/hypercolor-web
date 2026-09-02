"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ErrorDetails } from "@/components/error-details";
import { TruncatedPubky } from "@/components/truncated-pubky";
import { CUSTODY_LINE } from "@/lib/session-ui";

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
  onGenerateLink,
  onConfirmAdoption,
  onCancelAdoption,
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
  onGenerateLink: () => void;
  onConfirmAdoption: () => void;
  onCancelAdoption: () => void;
}) {
  return (
    <article className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">{appName}</h1>
      <p className="text-muted-foreground leading-7">{CUSTODY_LINE}</p>
      <p className="text-muted-foreground leading-7">
        Connect adopts an identity on this device. Enabling encrypted messaging is a second
        approval in Pubky Ring.
      </p>

      {isAuthenticated && pubky ? (
        <p className="text-sm text-muted-foreground">
          Signed in as <TruncatedPubky pubky={pubky} />.{" "}
          <Link href="/enable" className="underline underline-offset-4">
            Enable encrypted messaging
          </Link>
        </p>
      ) : (
        <Button
          type="button"
          data-testid="welcomeConnect"
          disabled={isLoading}
          onClick={onGenerateLink}
        >
          Connect with Pubky Ring
        </Button>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Preparing paykit-connect…</p>
      ) : null}

      {isExpired ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This paykit-connect link expired. Generate a new one.
          </p>
          <Button type="button" onClick={onGenerateLink}>
            Generate new link
          </Button>
        </div>
      ) : (
        authPanel
      )}

      {linkLive && !isExpired ? (
        <p className="text-sm text-muted-foreground">
          Waiting for Pubky Ring… Approve the request in Pubky Ring, or scan the code on another
          device.
        </p>
      ) : null}

      {pendingPubky ? (
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

      {error ? (
        <ErrorDetails fallback="Could not start authorization." details={error} />
      ) : null}
    </article>
  );
}
