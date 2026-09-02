"use client";

import Link from "next/link";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { Button } from "@/components/ui/button";
import { retrySessionRestore } from "@/lib/session-retry";
import { sessionCopy } from "@/lib/session-ui";

export function EnableMessagingCta({ testId }: { testId: string }) {
  const status = useSessionStatusStore((s) => s.status);
  if (status.kind === "enabled") return null;

  const copy = sessionCopy(status);

  return (
    <div
      className="rounded-md border border-border bg-card px-4 py-3 text-sm"
      data-testid={testId}
    >
      <p className="font-medium">{copy.label}</p>
      {copy.body ? <p className="mt-1 text-muted-foreground">{copy.body}</p> : null}
      {copy.primaryAction === "retry" ? (
        <Button
          type="button"
          className="mt-3"
          size="sm"
          onClick={() => {
            void retrySessionRestore();
          }}
        >
          {copy.primary}
        </Button>
      ) : copy.primaryHref ? (
        <Button asChild className="mt-3" size="sm">
          <Link href={copy.primaryHref}>{copy.primary}</Link>
        </Button>
      ) : null}
    </div>
  );
}
