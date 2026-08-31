"use client";

import Link from "next/link";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { Button } from "@/components/ui/button";

export function EnableMessagingCta({ testId }: { testId: string }) {
  const status = useSessionStatusStore((s) => s.status);
  if (status.kind === "enabled") return null;

  const href = status.kind === "no-identity" || status.kind === "unknown" ? "/" : "/enable";
  const label =
    status.kind === "no-identity" || status.kind === "unknown"
      ? "Connect with Pubky Ring"
      : status.kind === "session-offline"
        ? "Session offline — try again"
        : "Enable encrypted messaging";

  return (
    <div
      className="rounded-md border border-border bg-card px-4 py-3 text-sm"
      data-testid={testId}
      data-session-kind={status.kind}
    >
      <p className="text-muted-foreground">
        Encrypted chats need a Ring-approved Paykit session on this device.
      </p>
      <Button asChild className="mt-3" size="sm">
        <Link href={href}>{label}</Link>
      </Button>
    </div>
  );
}
