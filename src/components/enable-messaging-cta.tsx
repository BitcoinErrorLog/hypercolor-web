"use client";

import Link from "next/link";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { Button } from "@/components/ui/button";
import { retrySessionRestore } from "@/lib/session-retry";
import { sessionCopy } from "@/lib/session-ui";

export function EnableMessagingCta({
  testId,
  layout = "row",
}: {
  testId: string;
  layout?: "row" | "panel";
}) {
  const status = useSessionStatusStore((s) => s.status);
  if (status.kind === "enabled") return null;

  const copy = sessionCopy(status);
  const action =
    copy.primaryAction === "retry" ? (
      <Button
        type="button"
        variant="brand"
        size="sm"
        className={layout === "panel" ? "mt-3" : undefined}
        onClick={() => {
          void retrySessionRestore();
        }}
      >
        {copy.primary}
      </Button>
    ) : copy.primaryHref ? (
      <Button asChild variant="brand" size="sm" className={layout === "panel" ? "mt-3" : undefined}>
        <Link href={copy.primaryHref}>{copy.primary}</Link>
      </Button>
    ) : null;

  if (layout === "row") {
    return (
      <div
        className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm"
        data-testid={testId}
      >
        <div className="min-w-0">
          <p className="font-medium">{copy.label}</p>
          {copy.body ? <p className="sr-only">{copy.body}</p> : null}
        </div>
        {action}
      </div>
    );
  }

  return (
    <div
      className="rounded-md border border-border bg-card px-4 py-3 text-sm"
      data-testid={testId}
    >
      <p className="font-medium">{copy.label}</p>
      {copy.body ? <p className="mt-1 text-muted-foreground">{copy.body}</p> : null}
      {action}
    </div>
  );
}
