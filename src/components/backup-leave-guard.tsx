"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ModalSheet } from "@/components/ui/sheet";
import { useBlockingGate } from "@/hooks/useBlockingGate";
import { isE2eHarnessEnabled } from "@/lib/e2e-harness";
import {
  BACKUP_LEAVE_BODY,
  BACKUP_LEAVE_CONFIRM,
  BACKUP_LEAVE_STAY,
  BACKUP_LEAVE_TITLE,
  getBackupGate,
  getGateRestoreFocus,
  isBackupLeaveBlocked,
  onBackupGatePopState,
  onBackupGateRouteChange,
  requestGuardedNavigation,
  setBackupGate,
  shouldBlockHref,
} from "@/lib/backup-gate";
import type { InboxRow } from "@/lib/inbox";
import { useChannelsStore } from "@/stores/channelsStore";
import { useInboxStore } from "@/stores/inboxStore";

function resolveAnchorHref(anchor: HTMLAnchorElement): string | null {
  if (anchor.target === "_blank") return null;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return null;
  return href;
}

export function BackupLeaveGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const { pending, stay, leaveAnyway, stayRef, blocked } = useBlockingGate();

  useEffect(() => {
    if (!isE2eHarnessEnabled() || typeof window === "undefined") return;
    const host = window as Window & {
      __hypercolorSetBackupGate?: typeof setBackupGate;
      __hypercolorGetBackupGate?: typeof getBackupGate;
      __hypercolorSetPendingRequests?: (count: number) => void;
      __hypercolorSetChannelRows?: (rows: InboxRow[]) => void;
    };
    host.__hypercolorSetBackupGate = setBackupGate;
    host.__hypercolorGetBackupGate = getBackupGate;
    host.__hypercolorSetPendingRequests = (count) => {
      useInboxStore.getState().setPendingRequests(count);
    };
    host.__hypercolorSetChannelRows = (rows) => {
      useChannelsStore.getState().setRows(rows);
    };
    return () => {
      delete host.__hypercolorSetBackupGate;
      delete host.__hypercolorGetBackupGate;
      delete host.__hypercolorSetPendingRequests;
      delete host.__hypercolorSetChannelRows;
    };
  }, []);

  useEffect(() => {
    onBackupGateRouteChange(pathname);
  }, [pathname, blocked]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isBackupLeaveBlocked()) return;
      event.preventDefault();
      event.returnValue = BACKUP_LEAVE_TITLE;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!isBackupLeaveBlocked()) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = resolveAnchorHref(anchor);
      if (!href) return;
      if (!shouldBlockHref(href, pathname)) return;
      event.preventDefault();
      event.stopPropagation();
      requestGuardedNavigation(() => {
        router.push(href);
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isBackupLeaveBlocked()) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = resolveAnchorHref(anchor);
      if (!href) return;
      if (!shouldBlockHref(href, pathname)) return;
      event.preventDefault();
      event.stopPropagation();
      requestGuardedNavigation(() => {
        router.push(href);
      });
    };
    window.addEventListener("popstate", onBackupGatePopState);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("popstate", onBackupGatePopState);
    };
  }, [pathname, router]);

  return (
    <ModalSheet
      open={pending}
      onClose={stay}
      role="alertdialog"
      layer="gate"
      titleId="backup-leave-title"
      descriptionId="backup-leave-body"
      initialFocusRef={stayRef}
      restoreFocus={getGateRestoreFocus}
      testId="backupLeaveDialog"
    >
      <h2 id="backup-leave-title" className="text-lg font-semibold">
        {BACKUP_LEAVE_TITLE}
      </h2>
      <p id="backup-leave-body" className="text-sm text-muted-foreground">
        {BACKUP_LEAVE_BODY}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" ref={stayRef} onClick={stay} data-testid="backupLeaveStay">
          {BACKUP_LEAVE_STAY}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={leaveAnyway}
          data-testid="backupLeaveAnyway"
        >
          {BACKUP_LEAVE_CONFIRM}
        </Button>
      </div>
    </ModalSheet>
  );
}
