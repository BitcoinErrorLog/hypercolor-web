"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalSheet } from "@/components/ui/sheet";
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
  onSignOut: () => boolean | void;
}) {
  const [open, setOpen] = useState(false);
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        ref={triggerRef}
        data-testid={triggerTestId}
        onClick={() => {
          setLastBackup(readLastBackupAt());
          setOpen(true);
        }}
      >
        Sign out
      </Button>
      <ModalSheet
        open={open}
        onClose={close}
        role="alertdialog"
        titleId="sign-out-title"
        descriptionId="sign-out-body"
        initialFocusRef={cancelRef}
        testId="signOutDialog"
      >
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
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            data-testid="signOutConfirm"
            onClick={() => {
              const proceeded = onSignOut();
              if (proceeded === false) {
                setOpen(false);
              }
            }}
          >
            Sign out
          </Button>
        </div>
      </ModalSheet>
    </>
  );
}
