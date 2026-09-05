"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BackupLeaveGuard } from "@/components/backup-leave-guard";
import { PwaRegister } from "@/components/pwa-register";
import { SessionBanner } from "@/components/session-banner";
import { StandbyBanner } from "@/components/standby-banner";
import { SessionBootstrap } from "@/components/session-bootstrap";
import { SiteNav } from "@/components/site-nav";
import { TabLockBanner } from "@/components/tab-lock-banner";
import { APP_NAME } from "@/lib/app-meta";

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const design = pathname.startsWith("/design");

  return (
    <>
      <SessionBootstrap />
      <BackupLeaveGuard />
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      {design ? (
        <div id="main-content" tabIndex={-1} className="flex-1">
          {children}
        </div>
      ) : (
        <>
          <SessionBanner />
          <StandbyBanner />
          <TabLockBanner />
          <PwaRegister />
          <header className="border-b border-border">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-4">
              <p className="text-sm font-medium tracking-wide text-muted-foreground">{APP_NAME}</p>
              <SiteNav />
            </div>
          </header>
          <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-6 py-8 pb-24 md:pb-8">
            {children}
          </main>
        </>
      )}
    </>
  );
}
