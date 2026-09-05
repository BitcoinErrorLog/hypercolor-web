"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, PageSubtitle } from "@/components/ui/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Toast } from "@/components/ui/toast";
import { DetailBackLink } from "@/components/detail-back";
import { ErrorDetails } from "@/components/error-details";
import { TruncatedPubky } from "@/components/truncated-pubky";
import { EnableMessagingCta } from "@/components/enable-messaging-cta";
import { SignOutConfirm } from "@/components/sign-out-confirm";
import { useSignOut } from "@/hooks/useSignOut";
import { repairLocalData } from "@/db/repair";
import {
  canDismissRecoveryCode,
  chunkRecoveryCode,
  clearBackupGate,
  getBackupGate,
  rememberBackupCreated,
  setBackupGate,
} from "@/lib/backup-gate";
import { BACKUP_CUSTODY_LINE, CUSTODY_LINE, sessionStatusLabel } from "@/lib/session-ui";
import { BackupService } from "@/services/backup/BackupService";
import { emit } from "@/services/vibeware/collector";
import { emitCoarseError } from "@/services/vibeware/coarse";
import { useLeaveOnce } from "@/services/vibeware/leave";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

export type SettingsPageFixture = {
  recoveryCode?: string | null;
  confirmedSaved?: boolean;
  copied?: boolean;
  backupError?: string | null;
  restoreCode?: string;
  restoreError?: string | null;
  restoreNote?: string | null;
};

export function SettingsPage({ fixture }: { fixture?: SettingsPageFixture } = {}) {
  const homeserver = useAuthStore((s) => s.homeserver);
  const pubky = useAuthStore((s) => s.pubky);
  const status = useSessionStatusStore((s) => s.status);
  const { signOut, busy: signingOut } = useSignOut();
  const [backupBusy, setBackupBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(
    () => fixture?.recoveryCode ?? getBackupGate().recoveryCode,
  );
  const [confirmedSaved, setConfirmedSaved] = useState(() => fixture?.confirmedSaved ?? getBackupGate().confirmedSaved);
  const [copied, setCopied] = useState(fixture?.copied ?? false);
  const [restoreCode, setRestoreCode] = useState(fixture?.restoreCode ?? "");
  const [backupError, setBackupError] = useState<string | null>(fixture?.backupError ?? null);
  const [restoreError, setRestoreError] = useState<string | null>(fixture?.restoreError ?? null);
  const [restoreNote, setRestoreNote] = useState<string | null>(fixture?.restoreNote ?? null);
  const [repairConfirm, setRepairConfirm] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [repairNote, setRepairNote] = useState<string | null>(null);

  useLeaveOnce(
    "settings-backup",
    () => Boolean(recoveryCode) && !confirmedSaved,
    () => {
      void emit("app.backup.export_outcome", { outcome: "cancelled" });
    },
  );

  useEffect(() => {
    setBackupGate({ recoveryCode, confirmedSaved });
  }, [recoveryCode, confirmedSaved]);

  useEffect(() => {
    if (!__HYPERCOLOR_E2E_HARNESS__ || typeof window === "undefined") return;
    const host = window as Window & {
      __hypercolorShowRecovery?: (code: string) => void;
    };
    host.__hypercolorShowRecovery = (code) => {
      setRecoveryCode(code);
      setConfirmedSaved(false);
      setCopied(false);
      setBackupGate({ recoveryCode: code, confirmedSaved: false });
    };
    return () => {
      delete host.__hypercolorShowRecovery;
    };
  }, []);

  return (
    <article className="space-y-8" data-testid="settingsScreen" data-surface="settings-page">
      <DetailBackLink href="/profile" listLabel="Profile" always />
      <PageHeader>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <PageSubtitle>{pubky ? "Signed in" : "This device"}</PageSubtitle>
      </PageHeader>
      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Identity
        </h2>
        {pubky ? (
          <div className="flex items-center gap-3">
            <Avatar seed={pubky} size="lg" ring />
            <TruncatedPubky pubky={pubky} />
          </div>
        ) : (
          <p className="break-all font-mono text-sm text-muted-foreground">
            No identity on this device
          </p>
        )}
        <p className="text-sm text-muted-foreground">{CUSTODY_LINE}</p>
        <p className="text-sm text-muted-foreground">
          Homeserver: {homeserver || "not set"}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Messaging
        </h2>
        <p className="text-sm">{sessionStatusLabel(status)}</p>
        <EnableMessagingCta testId="settingsEnableMessaging" />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Encrypted backup
        </h2>
        <p className="text-sm text-muted-foreground">
          A backup encrypts your local history with a recovery code. Only you have that code —
          Hypercolor cannot restore your history without it.
        </p>
        <p className="text-sm text-muted-foreground">{BACKUP_CUSTODY_LINE}</p>
        <Button
          type="button"
          disabled={backupBusy}
          data-testid="settingsBackup"
          onClick={() => {
            setBackupBusy(true);
            setBackupError(null);
            setRestoreError(null);
            setRestoreNote(null);
            setConfirmedSaved(false);
            setCopied(false);
            void BackupService.exportBackup()
              .then((result) => {
                setRecoveryCode(result.recoveryCode);
                setBackupGate({ recoveryCode: result.recoveryCode, confirmedSaved: false });
                void emit("app.backup.export_outcome", { outcome: "shown" });
              })
              .catch((err) => {
                setBackupError(err instanceof Error ? err.message : "Backup failed");
                emitCoarseError("settings", err);
              })
              .finally(() => setBackupBusy(false));
          }}
        >
          {backupBusy && !recoveryCode ? "Encrypting…" : "Backup now"}
        </Button>
        {backupError ? (
          <ErrorDetails fallback="Could not create a backup." details={backupError} />
        ) : null}
        {recoveryCode ? (
          <div className="space-y-3 rounded-md border border-border bg-card p-4" data-testid="recoveryCodePanel">
            <p className="text-sm font-medium">Write this recovery code down</p>
            <p className="break-all font-mono text-sm" data-testid="recoveryCode">
              {chunkRecoveryCode(recoveryCode)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(recoveryCode).then(() => setCopied(true));
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <label className="flex min-h-11 items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmedSaved}
                onChange={(event) => setConfirmedSaved(event.target.checked)}
                data-testid="recoveryCodeSaved"
              />
              I have written this code down
            </label>
            <Button
              type="button"
              size="sm"
              disabled={!canDismissRecoveryCode({ recoveryCode, confirmedSaved })}
              data-testid="recoveryCodeDone"
              onClick={() => {
                void emit("app.backup.export_outcome", { outcome: "confirmed" });
                rememberBackupCreated();
                clearBackupGate();
                setRecoveryCode(null);
                setConfirmedSaved(false);
                setCopied(false);
              }}
            >
              Done
            </Button>
          </div>
        ) : null}

        <Input
          value={restoreCode}
          onChange={(event) => setRestoreCode(event.target.value)}
          placeholder="Paste recovery code to restore"
          autoCapitalize="none"
          autoCorrect="off"
          data-testid="settingsRestoreInput"
        />
        <Button
          type="button"
          variant="outline"
          disabled={backupBusy || restoreCode.trim().length === 0}
          data-testid="settingsRestore"
          onClick={() => {
            const code = restoreCode.trim();
            setBackupBusy(true);
            setRestoreError(null);
            setBackupError(null);
            setRestoreNote(null);
            void BackupService.restoreBackup(code)
              .then(() => {
                setRestoreCode("");
                setRestoreNote(
                  "Restore complete. History is local. Enable messaging again so links re-handshake. Attachments without keys stay unavailable until re-shared.",
                );
              })
              .catch((err) => {
                setRestoreError(err instanceof Error ? err.message : "Restore failed");
              })
              .finally(() => setBackupBusy(false));
          }}
        >
          Restore from backup
        </Button>
        {restoreError ? (
          <ErrorDetails fallback="That recovery code did not work." details={restoreError} />
        ) : null}
        {restoreNote ? (
          <Toast title="Restore complete" description={restoreNote} />
        ) : null}
      </section>

      <section id="repair-local-data" className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Repair local data
        </h2>
        <p className="text-sm text-muted-foreground">
          Deletes the saved chat database on this device and rebuilds it from your
          homeserver. Your identity and Ring session stay. Messages that have not
          finished saving in another tab will be lost.
        </p>
        {repairConfirm ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm">
              Repair now? This cannot be undone. Unsent messages that were not
              saved yet will be gone.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={repairBusy}
                data-testid="settingsRepairConfirm"
                onClick={() => {
                  setRepairBusy(true);
                  setRepairError(null);
                  void repairLocalData()
                    .then(() => {
                      setRepairNote("Local database rebuilt. Chats will refill from the homeserver.");
                      setRepairConfirm(false);
                    })
                    .catch((err) => {
                      setRepairError(err instanceof Error ? err.message : "Repair failed");
                    })
                    .finally(() => setRepairBusy(false));
                }}
              >
                {repairBusy ? "Repairing…" : "Yes, repair"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={repairBusy}
                onClick={() => setRepairConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            data-testid="settingsRepair"
            onClick={() => {
              setRepairConfirm(true);
              setRepairError(null);
              setRepairNote(null);
            }}
          >
            Repair local data
          </Button>
        )}
        {repairError ? (
          <ErrorDetails fallback="Could not repair local data." details={repairError} />
        ) : null}
        {repairNote ? <p className="text-sm text-muted-foreground">{repairNote}</p> : null}
      </section>

      <section>
        <SignOutConfirm
          triggerTestId="settingsSignOut"
          busy={signingOut}
          onSignOut={() => signOut()}
        />
      </section>
    </article>
  );
}
