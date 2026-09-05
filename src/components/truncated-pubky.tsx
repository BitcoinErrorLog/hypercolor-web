"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { stripPubkyPrefix } from "@/lib/formatPublicKey";

export function displayPubkyShort(pubky: string): string {
  return stripPubkyPrefix(pubky).slice(0, 8).toUpperCase();
}

export function TruncatedPubky({
  pubky,
  testId,
  className = "font-mono text-sm tracking-[1.2px] uppercase",
  full = false,
}: {
  pubky: string;
  testId?: string;
  className?: string;
  full?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const shown = full ? stripPubkyPrefix(pubky) : displayPubkyShort(pubky);

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      <span className={className} data-testid={testId} title={pubky}>
        {shown}
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
