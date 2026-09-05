"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { StandbyTakeoverDialog } from "@/components/standby-takeover-dialog";
import {
  REENABLE_BANNER_BODY,
  REENABLE_BANNER_TITLE,
  REENABLE_PRIMARY,
  REENABLE_SECONDARY,
  STANDBY_BANNER_BODY,
  STANDBY_BANNER_TITLE,
  STANDBY_PRIMARY,
  STANDBY_SECONDARY,
} from "@/services/link/provisionReceiver";
import { LinkService } from "@/services/link/LinkService";
import { useReceiverRoleStore } from "@/services/link/receiverRoleStore";

const bannerFrame =
  "border-b border-border hc-brand-banner px-4 py-3 text-sm text-card-foreground lg:px-6 xl:px-0";
const bannerInner =
  "mx-auto flex w-full max-w-(--container-max-width) flex-wrap items-center justify-between gap-3";

export function StandbyBanner() {
  const role = useReceiverRoleStore((s) => s.role);
  const toast = useReceiverRoleStore((s) => s.toast);
  const needsReenable = useReceiverRoleStore((s) => s.needsReenable);
  const snoozedStandby = useReceiverRoleStore((s) => s.snoozedStandby);
  const snoozedReenable = useReceiverRoleStore((s) => s.snoozedReenable);
  const clearToast = useReceiverRoleStore((s) => s.clearToast);
  const snoozeCurrentBanner = useReceiverRoleStore((s) => s.snoozeCurrentBanner);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showStandby = role === "standby" && !snoozedStandby;
  const showReenable = !showStandby && needsReenable && role === "active" && !snoozedReenable;
  const copy = showReenable
    ? {
        title: REENABLE_BANNER_TITLE,
        body: REENABLE_BANNER_BODY,
        primary: REENABLE_PRIMARY,
        secondary: REENABLE_SECONDARY,
        testId: "reenableBanner" as const,
        primaryTestId: "reenableTakeover" as const,
      }
    : {
        title: STANDBY_BANNER_TITLE,
        body: STANDBY_BANNER_BODY,
        primary: STANDBY_PRIMARY,
        secondary: STANDBY_SECONDARY,
        testId: "standbyBanner" as const,
        primaryTestId: "standbyTakeover" as const,
      };

  const onTakeover = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await LinkService.takeOverReceiver();
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
        className={bannerFrame}
        data-testid="takeoverToast"
        data-surface="standby-banner"
      >
        <div className={bannerInner}>
          <p>{toast}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => clearToast()}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  if (!showStandby && !showReenable) return null;

  return (
    <>
      <div
        role="status"
        className={bannerFrame}
        data-testid={copy.testId}
        data-surface="standby-banner"
      >
        <div className={bannerInner}>
          <div className="space-y-1">
            <p className="font-semibold text-foreground">{copy.title}</p>
            <p className="text-muted-foreground">{copy.body}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="brand"
              data-testid={copy.primaryTestId}
              onClick={() => setConfirmOpen(true)}
            >
              {copy.primary}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="standbyKeepExisting"
              onClick={() => snoozeCurrentBanner()}
            >
              {copy.secondary}
            </Button>
          </div>
        </div>
      </div>
      <StandbyTakeoverDialog
        open={confirmOpen}
        busy={busy}
        error={error}
        title={copy.title}
        body={copy.body}
        primary={copy.primary}
        secondary={copy.secondary}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          void onTakeover();
        }}
      />
    </>
  );
}
