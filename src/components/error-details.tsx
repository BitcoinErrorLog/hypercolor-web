"use client";

import { Button } from "@/components/ui/button";

export function ErrorDetails({
  fallback,
  details,
  onRetry,
  retryLabel = "Try again",
  live = "alert",
}: {
  fallback: string;
  details: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  live?: "alert" | "status";
}) {
  const role = live === "status" ? "status" : "alert";
  if (!details && !onRetry) {
    return (
      <p className="text-sm hc-danger-text" role={role}>
        {fallback}
      </p>
    );
  }
  const rawIsFallback = details === fallback;
  return (
    <div className="space-y-1 text-sm hc-danger-text" role={role}>
      <p>{fallback}</p>
      {details && !rawIsFallback ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Details</summary>
          <p className="mt-1 break-words text-muted-foreground">{details}</p>
        </details>
      ) : null}
      {onRetry ? (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
