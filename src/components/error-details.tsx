"use client";

import { Button } from "@/components/ui/button";
import { isReadOnlyTabError } from "@/db/errors";

export function ErrorDetails({
  fallback,
  details,
  onRetry,
  retryLabel = "Try again",
  live = "alert",
  onTakeOver,
  repairHref,
}: {
  fallback: string;
  details: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  live?: "alert" | "status";
  onTakeOver?: () => void;
  repairHref?: string;
}) {
  const role = live === "status" ? "status" : "alert";
  const inline = details && details !== fallback ? details : fallback;
  const showFallbackLead = Boolean(details && details !== fallback);
  const takeOver =
    onTakeOver && details && isReadOnlyTabError(new Error(details)) ? onTakeOver : undefined;
  if (!details && !onRetry && !takeOver && !repairHref) {
    return (
      <p className="text-sm hc-danger-text" role={role}>
        {fallback}
      </p>
    );
  }
  return (
    <div className="space-y-1 text-sm hc-danger-text" role={role}>
      {showFallbackLead ? <p>{fallback}</p> : null}
      <p className="break-words">{inline}</p>
      {onRetry ? (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
      {takeOver ? (
        <Button type="button" size="sm" onClick={takeOver} data-testid="takeOverWriting">
          Take over writing here
        </Button>
      ) : null}
      {repairHref ? (
        <p>
          <a href={repairHref} className="underline underline-offset-4" data-testid="repairLocalDataLink">
            Repair local data
          </a>
        </p>
      ) : null}
    </div>
  );
}
