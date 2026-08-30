"use client";

import { useEffect } from "react";
import {
  runDmEnsure,
  runDmSignup,
  runGroupCreate,
  runGroupGet,
  runGroupSend,
  runGroupSync,
} from "@/services/link/groupHarness";

declare global {
  interface Window {
    runDmSignup?: typeof runDmSignup;
    runDmEnsure?: typeof runDmEnsure;
    runGroupCreate?: typeof runGroupCreate;
    runGroupSend?: typeof runGroupSend;
    runGroupSync?: typeof runGroupSync;
    runGroupGet?: typeof runGroupGet;
  }
}

export function GroupsHarnessPage() {
  useEffect(() => {
    window.runDmSignup = runDmSignup;
    window.runDmEnsure = runDmEnsure;
    window.runGroupCreate = runGroupCreate;
    window.runGroupSend = runGroupSend;
    window.runGroupSync = runGroupSync;
    window.runGroupGet = runGroupGet;
    return () => {
      delete window.runDmSignup;
      delete window.runDmEnsure;
      delete window.runGroupCreate;
      delete window.runGroupSend;
      delete window.runGroupSync;
      delete window.runGroupGet;
    };
  }, []);

  return (
    <article className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Groups staging harness</h1>
      <p className="text-sm text-muted-foreground leading-6">
        Dev/e2e only. Playwright drives three browser contexts through{" "}
        <code>window.runDmSignup</code> / <code>runDmEnsure</code> /{" "}
        <code>runGroupCreate</code> / <code>runGroupSend</code> /{" "}
        <code>runGroupSync</code>. Signup tokens are not rendered.
      </p>
    </article>
  );
}
