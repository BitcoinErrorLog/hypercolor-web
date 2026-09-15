"use client";

import { useEffect } from "react";
import {
  installHomeserverBackupTransport,
  runBackupRestore,
  runBackupSignupExport,
} from "@/services/backup/backupHarness";

declare global {
  interface Window {
    runBackupSignupExport?: typeof runBackupSignupExport;
    runBackupRestore?: typeof runBackupRestore;
  }
}

export function BackupHarnessPage() {
  useEffect(() => {
    installHomeserverBackupTransport();
    window.runBackupSignupExport = runBackupSignupExport;
    window.runBackupRestore = runBackupRestore;
    return () => {
      delete window.runBackupSignupExport;
      delete window.runBackupRestore;
    };
  }, []);

  return (
    <article className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Backup staging harness</h1>
      <p className="text-sm text-muted-foreground leading-6">
        Dev/e2e only. Playwright drives <code>window.runBackupSignupExport</code> and{" "}
        <code>window.runBackupRestore</code>. Signup tokens and recovery codes are
        not rendered.
      </p>
    </article>
  );
}
