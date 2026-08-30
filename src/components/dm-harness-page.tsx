"use client";

import { useEffect } from "react";
import {
  runDmEnsure,
  runDmRound,
  runDmSend,
  runDmSignup,
  runDmSync,
} from "@/services/link/dmHarness";

declare global {
  interface Window {
    runDmSignup?: typeof runDmSignup;
    runDmEnsure?: typeof runDmEnsure;
    runDmSend?: typeof runDmSend;
    runDmSync?: typeof runDmSync;
    runDmRound?: typeof runDmRound;
  }
}

export function DmHarnessPage() {
  useEffect(() => {
    window.runDmSignup = runDmSignup;
    window.runDmEnsure = runDmEnsure;
    window.runDmSend = runDmSend;
    window.runDmSync = runDmSync;
    window.runDmRound = runDmRound;
  }, []);

  return (
    <article className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">DM staging harness</h1>
      <p className="text-sm text-muted-foreground leading-6">
        Dev/e2e only. Playwright drives two browser contexts through{" "}
        <code>window.runDmSignup</code> / <code>runDmEnsure</code> /{" "}
        <code>runDmSend</code> / <code>runDmSync</code>. Signup tokens are not
        rendered.
      </p>
    </article>
  );
}
