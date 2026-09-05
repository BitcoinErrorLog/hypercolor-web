"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BackupLeaveGuard } from "@/components/backup-leave-guard";
import { PwaRegister } from "@/components/pwa-register";
import { SessionBanner } from "@/components/session-banner";
import { StandbyBanner } from "@/components/standby-banner";
import { SessionBootstrap } from "@/components/session-bootstrap";
import { TabLockBanner } from "@/components/tab-lock-banner";
import { AppShell } from "@/components/shell/app-shell";
import { FilterHeader, FilterList, FilterRoot } from "@/components/ui/filter";
import { Toaster } from "@/components/ui/toast";
import { APP_NAME } from "@/lib/app-meta";

function shellTitle(pathname: string): string {
  if (pathname.startsWith("/chats")) return "Chats";
  if (pathname.startsWith("/channels")) return "Channels";
  if (pathname.startsWith("/contacts")) return "Contacts";
  if (pathname.startsWith("/requests")) return "Requests";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/profile")) return "Profile";
  if (pathname.startsWith("/discover")) return "Discover";
  if (pathname.startsWith("/enable")) return "Enable";
  if (pathname.startsWith("/ring-callback")) return "Ring callback";
  return APP_NAME;
}

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const e2e = pathname.startsWith("/e2e");
  const hideChrome =
    e2e ||
    pathname === "/" ||
    pathname.startsWith("/enable") ||
    pathname.startsWith("/ring-callback");
  const fillViewport =
    pathname.startsWith("/chats") ||
    pathname.startsWith("/contacts") ||
    pathname.startsWith("/channels") ||
    pathname.startsWith("/requests");
  const centerColumn =
    pathname.startsWith("/settings") ||
    pathname.startsWith("/profile") ||
    pathname.startsWith("/discover");

  const leftRail = pathname.startsWith("/chats") ? (
    <FilterRoot>
      <FilterHeader title="Inbox" subtitle="Direct" />
      <FilterList>
        <p className="py-1 text-base font-medium text-foreground">All</p>
      </FilterList>
    </FilterRoot>
  ) : pathname.startsWith("/contacts") ? (
    <FilterRoot>
      <FilterHeader title="People" subtitle="On this device" />
    </FilterRoot>
  ) : undefined;

  return (
    <>
      <SessionBootstrap />
      <BackupLeaveGuard />
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      {e2e ? (
        <div id="main-content" tabIndex={-1} className="flex-1">
          {children}
        </div>
      ) : (
        <>
          <SessionBanner />
          <StandbyBanner />
          <TabLockBanner />
          <PwaRegister />
          <Toaster />
          <AppShell
            title={shellTitle(pathname)}
            hideChrome={hideChrome}
            fillViewport={fillViewport}
            centerColumn={centerColumn}
            leftRail={hideChrome ? undefined : leftRail}
          >
            {children}
          </AppShell>
        </>
      )}
    </>
  );
}
