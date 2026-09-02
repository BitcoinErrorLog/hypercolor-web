"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { shortPubky } from "@/lib/format";

export function TruncatedPubky({
  pubky,
  testId,
  className = "font-mono text-sm",
}: {
  pubky: string;
  testId?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      <span className={className} data-testid={testId} title={pubky}>
        {shortPubky(pubky)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Copy full pubky"
        onClick={() => {
          void navigator.clipboard.writeText(pubky).then(() => setCopied(true));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  );
}

export function CopyPubkyButton({ pubky, label = "Copy my pubky" }: { pubky: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        void navigator.clipboard.writeText(pubky).then(() => setCopied(true));
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
