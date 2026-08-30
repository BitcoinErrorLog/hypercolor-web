"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { AuthUrlPanel } from "@/components/auth-url-panel";
import { Button } from "@/components/ui/button";
import { usePaykitConnect } from "@/hooks/usePaykitConnect";
import { APP_NAME } from "@/lib/app-meta";
import {
  completeHandoffAfterConfirmation,
  type HandoffPublicParams,
} from "@/services/RingConnect";
import { useAuthStore } from "@/stores/authStore";

export function WelcomePage() {
  const router = useRouter();
  const pubky = useAuthStore((s) => s.pubky);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [error, setError] = useState<string | null>(null);
  const [pendingParams, setPendingParams] = useState<HandoffPublicParams | null>(
    null,
  );
  const [adopting, setAdopting] = useState(false);

  const onParams = useCallback((params: HandoffPublicParams) => {
    setPendingParams(params);
  }, []);

  const connect = usePaykitConnect({
    autoStart: !isAuthenticated,
    onParams,
    onError: (err) =>
      setError(err instanceof Error ? err.message : "paykit-connect failed"),
  });

  async function confirmAdoption(accepted: boolean) {
    if (!pendingParams) return;
    if (!accepted) {
      setPendingParams(null);
      return;
    }
    setAdopting(true);
    try {
      const result = await completeHandoffAfterConfirmation(
        pendingParams,
        async () => true,
      );
      if (result) {
        router.push("/enable");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Handoff failed");
    } finally {
      setAdopting(false);
    }
  }

  return (
    <article className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
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

      {connect.isLoading ? (
        <p className="text-sm text-muted-foreground">Preparing paykit-connect…</p>
      ) : null}

      {connect.isExpired ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This paykit-connect link expired. Generate a new one.
          </p>
          <Button type="button" onClick={() => void connect.start()}>
            Generate new link
          </Button>
        </div>
      ) : (
        <AuthUrlPanel
          url={connect.url}
          title="Paykit-connect link"
          hint="Scan with Pubky Ring on this or another device."
          copyLabel="Copy URL"
          openLabel="Open Pubky Ring"
          testIdPrefix="welcome"
        />
      )}

      {pendingParams ? (
        <div
          className="space-y-3 rounded-md border border-border bg-card p-4"
          data-testid="welcomeAdopt"
        >
          <p className="text-sm leading-6">
            Continue as{" "}
            <code className="break-all font-mono">{pendingParams.pubky}</code>?
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={adopting}
              onClick={() => void confirmAdoption(true)}
            >
              Continue
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={adopting}
              onClick={() => void confirmAdoption(false)}
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
