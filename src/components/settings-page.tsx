"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSignOut } from "@/hooks/useSignOut";
import { canDismissRecoveryCode } from "@/lib/backup-gate";
import { sessionStatusLabel } from "@/lib/session-ui";
import { BackupService } from "@/services/backup/BackupService";
import { emit } from "@/services/vibeware/collector";
import { emitCoarseError } from "@/services/vibeware/coarse";
import { useLeaveOnce } from "@/services/vibeware/leave";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

export function SettingsPage() {
  const homeserver = useAuthStore((s) => s.homeserver);
  const pubky = useAuthStore((s) => s.pubky);
  const status = useSessionStatusStore((s) => s.status);
  const { signOut, busy: signingOut } = useSignOut();
  const [backupBusy, setBackupBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restoreCode, setRestoreCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const recoveryCodeRef = useRef<string | null>(null);
  const confirmedSavedRef = useRef(false);
  recoveryCodeRef.current = recoveryCode;
  confirmedSavedRef.current = confirmedSaved;

  useLeaveOnce(
    "settings-backup",
    () => Boolean(recoveryCodeRef.current) && !confirmedSavedRef.current,
    () => {
      void emit("app.backup.export_outcome", { outcome: "cancelled" });
    },
  );

  return (
    <article className="space-y-8" data-testid="settingsScreen">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Session
        </h2>
        <p className="text-sm">{sessionStatusLabel(status)}</p>
        <p className="break-all font-mono text-sm text-muted-foreground">
          {pubky ?? "No identity on this device"}
        </p>
        <p className="text-sm text-muted-foreground">
          Homeserver: {homeserver || "not set"}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Encrypted backup
        </h2>
        <p className="text-sm text-muted-foreground">
          Backup uses a random recovery code, not a passphrase. History (contacts,
          chats, groups, payments, tip lists) restores. Live Encrypted Links
          re-establish on this device. Attachment files without keys show as
          unavailable until re-shared. The recovery code is shown once and is
          never stored here.
        </p>
        <Button
          type="button"
          disabled={backupBusy}
          data-testid="settingsBackup"
          onClick={() => {
            setBackupBusy(true);
            setNote(null);
            setConfirmedSaved(false);
            setCopied(false);
            void BackupService.exportBackup()
              .then((result) => {
                setRecoveryCode(result.recoveryCode);
                void emit("app.backup.export_outcome", { outcome: "shown" });
              })
              .catch((err) => {
                setNote(err instanceof Error ? err.message : "Backup failed");
                emitCoarseError("settings", err);
              })
              .finally(() => setBackupBusy(false));
          }}
        >
          {backupBusy ? "Working…" : "Backup now"}
        </Button>
        {recoveryCode ? (
          <div className="space-y-3 rounded-md border border-border bg-card p-4" data-testid="recoveryCodePanel">
            <p className="text-sm font-medium">Write this recovery code down</p>
            <p className="break-all font-mono text-sm" data-testid="recoveryCode">
              {recoveryCode}
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
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmedSaved}
                onChange={(event) => setConfirmedSaved(event.target.checked)}
                data-testid="recoveryCodeSaved"
              />
              I have saved this recovery code somewhere I control.
            </label>
            <Button
              type="button"
              size="sm"
              disabled={!canDismissRecoveryCode({ recoveryCode, confirmedSaved })}
              onClick={() => {
                void emit("app.backup.export_outcome", { outcome: "confirmed" });
                setRecoveryCode(null);
                setConfirmedSaved(false);
                setCopied(false);
              }}
            >
              I saved it — hide this code
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
            setNote(null);
            void BackupService.restoreBackup(code)
              .then(() => {
                setRestoreCode("");
                setNote(
                  "Restore complete. History is local. Enable messaging again so links re-handshake. Attachments without keys stay unavailable until re-shared.",
                );
              })
              .catch((err) => {
                setNote(err instanceof Error ? err.message : "Restore failed");
              })
              .finally(() => setBackupBusy(false));
          }}
        >
          Restore from backup
        </Button>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </section>

      <section>
        <Button
          type="button"
          variant="outline"
          disabled={signingOut}
          data-testid="settingsSignOut"
          onClick={() => void signOut()}
        >
          Sign out
        </Button>
      </section>
    </article>
  );
}
