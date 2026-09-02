"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { isE2eHarnessEnabled } from "@/lib/e2e-harness";
import {
  BACKUP_LEAVE_BODY,
  BACKUP_LEAVE_CONFIRM,
  BACKUP_LEAVE_STAY,
  BACKUP_LEAVE_TITLE,
  clearBackupGate,
  isBackupLeaveBlocked,
  setBackupGate,
  shouldBlockHref,
  subscribeBackupGate,
} from "@/lib/backup-gate";

type PendingNav = { href: string } | { historyBack: true } | null;

export function BackupLeaveGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const [blocked, setBlocked] = useState(isBackupLeaveBlocked);
  const [pending, setPending] = useState<PendingNav>(null);
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeBackupGate(() => setBlocked(isBackupLeaveBlocked())), []);

  useEffect(() => {
    if (!isE2eHarnessEnabled() || typeof window === "undefined") return;
    const host = window as Window & { __hypercolorSetBackupGate?: typeof setBackupGate };
    host.__hypercolorSetBackupGate = setBackupGate;
    return () => {
      delete host.__hypercolorSetBackupGate;
    };
  }, []);

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
      if (!anchor || anchor.target === "_blank") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (!shouldBlockHref(href, pathname)) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ href });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  useEffect(() => {
    if (!blocked) return;
    const onPopState = () => {
      if (!isBackupLeaveBlocked()) return;
      history.pushState({ backupGate: true }, "", window.location.href);
      setPending({ historyBack: true });
    };
    history.pushState({ backupGate: true }, "", window.location.href);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [blocked]);

  useEffect(() => {
    if (pending) stayRef.current?.focus();
  }, [pending]);

  function stay() {
    setPending(null);
  }

  function leaveAnyway() {
    const dest = pending;
    clearBackupGate();
    setPending(null);
    if (!dest) return;
    if ("historyBack" in dest) {
      window.history.back();
      return;
    }
    router.push(dest.href);
  }

  if (!pending) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="backup-leave-title"
      aria-describedby="backup-leave-body"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6"
      data-testid="backupLeaveDialog"
    >
      <div className="w-full max-w-md space-y-4 rounded-md border border-border bg-card p-5">
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
      </div>
    </div>
  );
}
