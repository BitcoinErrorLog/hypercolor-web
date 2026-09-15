"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

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
  onGenerateLink: () => void;
  onConfirmAdoption: () => void;
  onCancelAdoption: () => void;
}) {
  return (
    <article className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">{appName}</h1>
      <p className="text-muted-foreground leading-7">
        Your identity is managed by <strong>Pubky Ring</strong>. Hypercolor
        never holds your private key. Scan or copy the paykit-connect URL,
        then enable messaging with a second Ring approval.
      </p>

      {isAuthenticated && pubky ? (
        <p className="text-sm text-muted-foreground">
          Signed in as{" "}
          <code className="break-all font-mono text-foreground">{pubky}</code>.{" "}
          <Link href="/enable" className="underline underline-offset-4">
            Enable messaging
          </Link>
        </p>
      ) : null}

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

      {pendingPubky ? (
        <div
          className="space-y-3 rounded-md border border-border bg-card p-4"
          data-testid="welcomeAdopt"
        >
          <p className="text-sm leading-6">
            Continue as{" "}
            <code className="break-all font-mono">{pendingPubky}</code>?
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

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </article>
  );
}
