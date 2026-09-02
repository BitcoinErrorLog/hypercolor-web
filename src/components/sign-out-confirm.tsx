"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import { readLastBackupAt } from "@/lib/backup-gate";
import { CUSTODY_LINE } from "@/lib/session-ui";

export function SignOutConfirm({
  triggerTestId,
  busy,
  onSignOut,
}: {
  triggerTestId: string;
  busy: boolean;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        data-testid={triggerTestId}
        onClick={() => {
          setLastBackup(readLastBackupAt());
          setOpen(true);
        }}
      >
        Sign out
      </Button>
      {open ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="sign-out-title"
          aria-describedby="sign-out-body"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6"
          data-testid="signOutDialog"
        >
          <div className="w-full max-w-md space-y-4 rounded-md border border-border bg-card p-5">
            <h2 id="sign-out-title" className="text-lg font-semibold">
              Sign out of Hypercolor?
            </h2>
            <div id="sign-out-body" className="space-y-2 text-sm text-muted-foreground">
              <p>
                This device deletes your chats, groups, contacts, attachments, and the Paykit
                session. Pubky Ring keeps your key and your identity — you can connect again and
                re-authorize.
              </p>
              <p>
                {lastBackup
                  ? `Your last backup was ${formatRelativeTime(lastBackup)}.`
                  : "If you have not made an encrypted backup, this history is not recoverable."}
              </p>
              <p>{CUSTODY_LINE}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                ref={cancelRef}
                variant="outline"
                data-testid="signOutCancel"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy}
                data-testid="signOutConfirm"
                onClick={() => onSignOut()}
              >
                Sign out
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
