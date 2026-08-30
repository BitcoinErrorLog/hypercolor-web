"use client";

import { useEffect } from "react";
import { runOwnerRoundtrip } from "@/services/link/ownerRoundtrip";

declare global {
  interface Window {
    runOwnerRoundtrip?: typeof runOwnerRoundtrip;
  }
}

export function OwnerRoundtripPage() {
  useEffect(() => {
    window.runOwnerRoundtrip = runOwnerRoundtrip;
  }, []);

  return (
    <article className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Owner round-trip harness</h1>
      <p className="text-sm text-muted-foreground leading-6">
        Dev/e2e only. Playwright calls <code>window.runOwnerRoundtrip</code> with
        a staging signup token. The token is not rendered.
      </p>
    </article>
  );
}
