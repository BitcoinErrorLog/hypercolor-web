"use client";

import type { ReactNode } from "react";
import { AuthQr } from "@/components/auth-qr";

export function AuthUrlPanel({
  url,
  title,
  hint,
  testIdPrefix,
  actions,
}: {
  url: string;
  title: string;
  hint: string;
  testIdPrefix: string;
  actions: ReactNode;
}) {
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
      {actions}
    </div>
  );
}
