"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ModalSheet } from "@/components/ui/sheet";
import {
  STANDBY_BANNER_BODY,
  STANDBY_BANNER_TITLE,
  STANDBY_PRIMARY,
  STANDBY_SECONDARY,
} from "@/services/link/provisionReceiver";

export function StandbyTakeoverDialog({
  open,
  busy,
  error,
  title = STANDBY_BANNER_TITLE,
  body = STANDBY_BANNER_BODY,
  primary = STANDBY_PRIMARY,
  secondary = STANDBY_SECONDARY,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  title?: string;
  body?: string;
  primary?: string;
  secondary?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      role="alertdialog"
      titleId="standby-takeover-title"
      descriptionId="standby-takeover-body"
      initialFocusRef={cancelRef}
      testId="standbyTakeoverDialog"
      surface="standby-takeover-confirm"
    >
      <h2 id="standby-takeover-title" className="text-lg font-semibold text-foreground">
        {title}
      </h2>
      <p id="standby-takeover-body" className="text-sm text-muted-foreground">
        {body}
      </p>
      {error ? <p className="text-sm hc-danger-text">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          ref={cancelRef}
          variant="outline"
          data-testid="standbyTakeoverCancel"
          onClick={onClose}
        >
          {secondary}
        </Button>
        <Button
          type="button"
          variant="brand"
          data-testid="standbyTakeoverConfirm"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "Taking over…" : primary}
        </Button>
      </div>
    </ModalSheet>
  );
}

export function StandbyReceiveButton({
  testId,
  onTakeover,
  children,
}: {
  testId: string;
  onTakeover: () => Promise<void>;
  children?: ReactNode;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="brand"
        data-testid={testId}
        onClick={() => setConfirmOpen(true)}
      >
        {children ?? STANDBY_PRIMARY}
      </Button>
      <StandbyTakeoverDialog
        open={confirmOpen}
        busy={busy}
        error={error}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              await onTakeover();
              setConfirmOpen(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not take over this device.");
            } finally {
              setBusy(false);
            }
          })();
        }}
      />
    </>
  );
}
