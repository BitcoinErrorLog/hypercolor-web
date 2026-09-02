"use client";

import { Button } from "@/components/ui/button";
import { retrySessionRestore } from "@/lib/session-retry";
import { sessionStatusLabel } from "@/lib/session-ui";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

export function SessionBanner() {
  const status = useSessionStatusStore((s) => s.status);

  if (status.kind !== "session-offline") {
    return null;
  }

  return (
    <div
      role="status"
      className="border-b border-border bg-card px-6 py-3 text-sm"
      data-testid="sessionBanner"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
        <p>{sessionStatusLabel(status)}</p>
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
