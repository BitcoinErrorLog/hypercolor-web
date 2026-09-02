"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  armHistoryTrap,
  cancelPendingBackupLeave,
  confirmPendingBackupLeave,
  hasPendingBackupLeave,
  isBackupLeaveBlocked,
  requestGuardedNavigation,
  shouldBlockHref,
  subscribeBackupGate,
} from "@/lib/backup-gate";

export function useBlockingGate() {
  const router = useRouter();
  const pathname = usePathname();
  const [blocked, setBlocked] = useState(isBackupLeaveBlocked);
  const [pending, setPending] = useState(hasPendingBackupLeave);
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    return subscribeBackupGate(() => {
      setBlocked(isBackupLeaveBlocked());
      setPending(hasPendingBackupLeave());
    });
  }, []);

  const requestPush = useCallback(
    (href: string) => {
      return requestGuardedNavigation(() => {
        router.push(href);
      });
    },
    [router],
  );

  const requestReplace = useCallback(
    (href: string) => {
      return requestGuardedNavigation(() => {
        router.replace(href);
      });
    },
    [router],
  );

  const requestBack = useCallback(() => {
    return requestGuardedNavigation(() => {
      router.back();
    });
  }, [router]);

  const requestRun = useCallback((run: () => void) => {
    return requestGuardedNavigation(run);
  }, []);

  const stay = useCallback(() => {
    cancelPendingBackupLeave();
    if (pathname !== "/settings" && isBackupLeaveBlocked()) {
      router.push("/settings");
      return;
    }
    armHistoryTrap();
  }, [pathname, router]);

  const leaveAnyway = useCallback(() => {
    confirmPendingBackupLeave();
  }, []);

  return {
    blocked,
    pending,
    pathname,
    stayRef,
    requestPush,
    requestReplace,
    requestBack,
    requestRun,
    stay,
    leaveAnyway,
    armHistoryTrap,
    shouldBlockHref,
  };
}

export function useGuardedRouter() {
  const { requestPush, requestReplace, requestBack } = useBlockingGate();
  return {
    push: requestPush,
    replace: requestReplace,
    back: requestBack,
  };
}
