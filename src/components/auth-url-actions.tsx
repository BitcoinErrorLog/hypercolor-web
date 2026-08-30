"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function AuthUrlActions({
  url,
  copyLabel,
  openLabel,
  testIdPrefix,
}: {
  url: string;
  copyLabel: string;
  openLabel: string;
  testIdPrefix: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  if (!url) return null;

  return (
    <>
      <p className="break-all font-mono text-sm text-foreground/80">{url}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild>
          <a
            href={url}
            data-testid={`${testIdPrefix}OpenRing`}
            aria-label={openLabel}
          >
            {openLabel}
          </a>
        </Button>
        <Button
          type="button"
          variant="outline"
          data-testid={`${testIdPrefix}Copy`}
          aria-label={copyLabel}
          onClick={() => {
            void handleCopy();
          }}
        >
          {copied ? "Copied" : copyLabel}
        </Button>
      </div>
    </>
  );
}
