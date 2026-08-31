"use client";

import { useEffect } from "react";
import {
  runDmEnsure,
  runDmSend,
  runDmSync,
  runMigrationGetAttachment,
  runMigrationGetPublicDoc,
  runMigrationIdentity,
  runMigrationLocalBodies,
  runMigrationProbeMarker,
  runMigrationPutAttachment,
  runMigrationPublicGetCiphertext,
  runMigrationPutPublicDoc,
  runMigrationSignup,
  runMigrationTo,
  runMigrationRebindPeer,
  runMigrationRebindPeerLink,
  runMigrationBustPeerHomeserver,
} from "@/services/link/migrationHarness";

declare global {
  interface Window {
    runMigrationSignup?: typeof runMigrationSignup;
    runMigrationTo?: typeof runMigrationTo;
    runMigrationRebindPeer?: typeof runMigrationRebindPeer;
    runMigrationRebindPeerLink?: typeof runMigrationRebindPeerLink;
    runMigrationBustPeerHomeserver?: typeof runMigrationBustPeerHomeserver;
    runMigrationIdentity?: typeof runMigrationIdentity;
    runMigrationLocalBodies?: typeof runMigrationLocalBodies;
    runMigrationProbeMarker?: typeof runMigrationProbeMarker;
    runMigrationPutAttachment?: typeof runMigrationPutAttachment;
    runMigrationGetAttachment?: typeof runMigrationGetAttachment;
    runMigrationPutPublicDoc?: typeof runMigrationPutPublicDoc;
    runMigrationGetPublicDoc?: typeof runMigrationGetPublicDoc;
    runMigrationPublicGetCiphertext?: typeof runMigrationPublicGetCiphertext;
    runDmEnsure?: typeof runDmEnsure;
    runDmSend?: typeof runDmSend;
    runDmSync?: typeof runDmSync;
  }
}

export function MigrationHarnessPage() {
  useEffect(() => {
    window.runMigrationSignup = runMigrationSignup;
    window.runMigrationTo = runMigrationTo;
    window.runMigrationRebindPeer = runMigrationRebindPeer;
    window.runMigrationRebindPeerLink = runMigrationRebindPeerLink;
    window.runMigrationBustPeerHomeserver = runMigrationBustPeerHomeserver;
    window.runMigrationIdentity = runMigrationIdentity;
    window.runMigrationLocalBodies = runMigrationLocalBodies;
    window.runMigrationProbeMarker = runMigrationProbeMarker;
    window.runMigrationPutAttachment = runMigrationPutAttachment;
    window.runMigrationGetAttachment = runMigrationGetAttachment;
    window.runMigrationPutPublicDoc = runMigrationPutPublicDoc;
    window.runMigrationGetPublicDoc = runMigrationGetPublicDoc;
    window.runMigrationPublicGetCiphertext = runMigrationPublicGetCiphertext;
    window.runDmEnsure = runDmEnsure;
    window.runDmSend = runDmSend;
    window.runDmSync = runDmSync;
    return () => {
      delete window.runMigrationSignup;
      delete window.runMigrationTo;
      delete window.runMigrationRebindPeer;
      delete window.runMigrationRebindPeerLink;
      delete window.runMigrationBustPeerHomeserver;
      delete window.runMigrationIdentity;
      delete window.runMigrationLocalBodies;
      delete window.runMigrationProbeMarker;
      delete window.runMigrationPutAttachment;
      delete window.runMigrationGetAttachment;
      delete window.runMigrationPutPublicDoc;
      delete window.runMigrationGetPublicDoc;
      delete window.runMigrationPublicGetCiphertext;
      delete window.runDmEnsure;
      delete window.runDmSend;
      delete window.runDmSync;
    };
  }, []);

  return (
    <article className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">
        Homeserver migration harness
      </h1>
      <p className="text-sm text-muted-foreground leading-6">
        Dev/e2e only. Playwright drives two browsers through signup, Encrypted
        Link chat, then a homeserver migrate. Signup tokens and identity
        secrets are not rendered.
      </p>
    </article>
  );
}
