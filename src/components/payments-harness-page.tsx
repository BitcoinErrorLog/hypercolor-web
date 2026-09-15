"use client";

import { useEffect } from "react";
import {
  runDmEnsure,
  runDmSignup,
  runPaymentsReadPublic,
  runPaymentsReceivePrivateList,
  runPaymentsRemoveEndpoint,
  runPaymentsSendPrivateList,
  runPaymentsSetEndpoint,
} from "@/services/payments/paymentsHarness";

declare global {
  interface Window {
    runDmSignup?: typeof runDmSignup;
    runDmEnsure?: typeof runDmEnsure;
    runPaymentsSetEndpoint?: typeof runPaymentsSetEndpoint;
    runPaymentsRemoveEndpoint?: typeof runPaymentsRemoveEndpoint;
    runPaymentsReadPublic?: typeof runPaymentsReadPublic;
    runPaymentsSendPrivateList?: typeof runPaymentsSendPrivateList;
    runPaymentsReceivePrivateList?: typeof runPaymentsReceivePrivateList;
  }
}

export function PaymentsHarnessPage() {
  useEffect(() => {
    window.runDmSignup = runDmSignup;
    window.runDmEnsure = runDmEnsure;
    window.runPaymentsSetEndpoint = runPaymentsSetEndpoint;
    window.runPaymentsRemoveEndpoint = runPaymentsRemoveEndpoint;
    window.runPaymentsReadPublic = runPaymentsReadPublic;
    window.runPaymentsSendPrivateList = runPaymentsSendPrivateList;
    window.runPaymentsReceivePrivateList = runPaymentsReceivePrivateList;
    return () => {
      delete window.runDmSignup;
      delete window.runDmEnsure;
      delete window.runPaymentsSetEndpoint;
      delete window.runPaymentsRemoveEndpoint;
      delete window.runPaymentsReadPublic;
      delete window.runPaymentsSendPrivateList;
      delete window.runPaymentsReceivePrivateList;
    };
  }, []);

  return (
    <article className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Payments staging harness</h1>
      <p className="text-sm text-muted-foreground leading-6">
        Dev/e2e only. Playwright drives two browser contexts through{" "}
        <code>window.runDmSignup</code> / <code>runPaymentsSetEndpoint</code> /{" "}
        <code>runPaymentsReadPublic</code> / <code>runPaymentsSendPrivateList</code> /{" "}
        <code>runPaymentsReceivePrivateList</code>. Signup tokens are not
        rendered.
      </p>
    </article>
  );
}
