"use client";

export function ErrorDetails({
  fallback,
  details,
}: {
  fallback: string;
  details: string | null;
}) {
  if (!details) {
    return <p className="text-sm text-red-400">{fallback}</p>;
  }
  const rawIsFallback = details === fallback;
  return (
    <div className="space-y-1 text-sm text-red-400">
      <p>{fallback}</p>
      {!rawIsFallback ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Details</summary>
          <p className="mt-1 break-words text-muted-foreground">{details}</p>
        </details>
      ) : null}
    </div>
  );
}
