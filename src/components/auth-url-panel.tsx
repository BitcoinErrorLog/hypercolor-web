"use client";

import { useState } from "react";
import { AuthQr } from "@/components/auth-qr";
import { Button } from "@/components/ui/button";

export function AuthUrlPanel({
  url,
  title,
  hint,
  copyLabel,
  openLabel,
  testIdPrefix,
}: {
  url: string;
  title: string;
  hint: string;
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
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <p className="text-sm text-muted-foreground" data-testid={`${testIdPrefix}ScanHint`}>
        {hint}
      </p>
      <AuthQr value={url} testID={`${testIdPrefix}Qr`} />
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
    </div>
  );
}
