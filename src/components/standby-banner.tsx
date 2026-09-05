"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalSheet } from "@/components/ui/sheet";
import {
  STANDBY_BANNER_BODY,
  STANDBY_BANNER_TITLE,
  STANDBY_PRIMARY,
  STANDBY_SECONDARY,
  takeoverLiveReceiver,
} from "@/services/link/provisionReceiver";
import { useReceiverRoleStore } from "@/services/link/receiverRoleStore";

export function StandbyBanner() {
  const role = useReceiverRoleStore((s) => s.role);
  const toast = useReceiverRoleStore((s) => s.toast);
  const clearToast = useReceiverRoleStore((s) => s.clearToast);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const onTakeover = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await takeoverLiveReceiver();
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not take over this device.");
    } finally {
      setBusy(false);
    }
  }, []);

  if (toast) {
    return (
      <div
        role="status"
        className="border-b border-border bg-card px-6 py-3 text-sm"
        data-testid="takeoverToast"
        data-surface="standby-banner"
      >
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
          <p>{toast}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => clearToast()}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  if (role !== "standby") return null;

  return (
    <>
      <div
        role="status"
        className="border-b border-border bg-card px-6 py-3 text-sm"
        data-testid="standbyBanner"
        data-surface="standby-banner"
      >
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="font-medium">{STANDBY_BANNER_TITLE}</p>
            <p className="text-muted-foreground">{STANDBY_BANNER_BODY}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="standbyTakeover"
              onClick={() => setConfirmOpen(true)}
            >
              {STANDBY_PRIMARY}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="standbyKeepExisting"
              onClick={() => undefined}
            >
              {STANDBY_SECONDARY}
            </Button>
          </div>
        </div>
      </div>
      <ModalSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        role="alertdialog"
        titleId="standby-takeover-title"
        descriptionId="standby-takeover-body"
        initialFocusRef={cancelRef}
        testId="standbyTakeoverDialog"
        surface="standby-takeover-confirm"
      >
        <h2 id="standby-takeover-title" className="text-lg font-semibold">
          {STANDBY_BANNER_TITLE}
        </h2>
        <p id="standby-takeover-body" className="text-sm text-muted-foreground">
          {STANDBY_BANNER_BODY}
        </p>
        {error ? <p className="text-sm hc-danger-text">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            ref={cancelRef}
            variant="outline"
            data-testid="standbyTakeoverCancel"
            onClick={() => setConfirmOpen(false)}
          >
            {STANDBY_SECONDARY}
          </Button>
          <Button
            type="button"
            data-testid="standbyTakeoverConfirm"
            disabled={busy}
            onClick={() => {
              void onTakeover();
            }}
          >
            {busy ? "Taking over…" : STANDBY_PRIMARY}
          </Button>
        </div>
      </ModalSheet>
    </>
  );
}
