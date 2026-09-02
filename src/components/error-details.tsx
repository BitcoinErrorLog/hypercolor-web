"use client";

import { Button } from "@/components/ui/button";

export function ErrorDetails({
  fallback,
  details,
  onRetry,
  retryLabel = "Try again",
}: {
  fallback: string;
  details: string | null;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  if (!details && !onRetry) {
    return (
      <p className="text-sm text-red-400" role="alert">
        {fallback}
      </p>
    );
  }
  const rawIsFallback = details === fallback;
  return (
    <div className="space-y-1 text-sm text-red-400" role="alert">
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
