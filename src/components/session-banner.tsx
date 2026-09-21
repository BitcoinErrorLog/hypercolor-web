"use client";

import { Button } from "@/components/ui/button";
import { retrySessionRestore } from "@/lib/session-retry";
import { sessionStatusLabel } from "@/lib/session-ui";
import { useSessionStatusStore, type SessionUiStatus } from "@/stores/sessionStatusStore";

export function SessionBanner({ fixtureStatus }: { fixtureStatus?: SessionUiStatus } = {}) {
  const storedStatus = useSessionStatusStore((s) => s.status);
  const status = fixtureStatus ?? storedStatus;

  if (status.kind !== "session-offline") {
    return null;
  }

  return (
    <div
      role="status"
      className="border-b border-border hc-brand-banner px-6 py-3 text-sm"
      data-testid="sessionBanner"
      data-surface="session-banner"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
        <p className="whitespace-nowrap">{sessionStatusLabel(status)}</p>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void retrySessionRestore();
          }}
        >
          Try again
        </Button>
      </div>
    </div>
  );
}
