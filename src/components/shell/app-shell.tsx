"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SiteNav } from "@/components/site-nav";

export function AppShell({
  title,
  leftRail,
  rightRail,
  children,
  hideChrome = false,
  fillViewport = false,
  centerColumn = false,
  headerAccessory,
}: {
  title: string;
  leftRail?: ReactNode;
  rightRail?: ReactNode;
  children: ReactNode;
  hideChrome?: boolean;
  fillViewport?: boolean;
  centerColumn?: boolean;
  headerAccessory?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-svh flex-1 flex-col bg-background text-foreground hc-app-font",
        fillViewport && "h-svh overflow-hidden",
      )}
    >
      {!hideChrome ? (
        <header className="pointer-events-none sticky top-0 z-(--z-sticky-header) w-full shrink-0 bg-linear-to-b from-(--background) from-50% to-transparent hc-header-iridescent">
          <div className="pointer-events-auto mx-auto flex h-16 w-full max-w-(--container-max-width) flex-row items-center justify-between gap-6 px-4 lg:h-24 lg:px-6 xl:px-0">
            <div className="flex min-w-0 items-center gap-3">
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              {headerAccessory}
            </div>
            <SiteNav />
          </div>
        </header>
      ) : null}

      <div
        className={cn(
          "mx-auto flex w-full min-w-0 max-w-(--container-max-width) px-4 lg:px-6 xl:px-0",
          hideChrome && "min-h-svh w-full flex-col justify-center py-8",
          fillViewport && !hideChrome && "hc-mobile-nav-inset flex min-h-0 flex-1 items-stretch gap-6 overflow-hidden lg:min-h-[calc(100svh-var(--header-height))] lg:pb-0",
          !fillViewport && !hideChrome && "hc-mobile-nav-inset flex flex-1 gap-6 lg:pb-10",
        )}
      >
        {leftRail ? (
          <aside className="sticky top-(--header-offset-main) hidden w-(--filter-bar-width) max-w-(--filter-bar-width) min-w-(--filter-bar-width) shrink-0 flex-col gap-6 overflow-y-auto lg:flex hc-rail-max">
            {leftRail}
          </aside>
        ) : null}
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "min-w-0 hc-programmatic-focus",
            hideChrome && "mx-auto w-full max-w-3xl flex-none",
            !hideChrome && !centerColumn && "flex-1",
            fillViewport && !centerColumn && "hc-fill-viewport flex h-full min-h-0 flex-col overflow-hidden lg:min-h-[calc(100svh-var(--header-height))]",
            centerColumn && "mx-auto flex h-full w-full max-w-3xl flex-col py-8",
          )}
        >
          {children}
        </main>
        {rightRail ? (
          <aside className="sticky top-(--header-offset-main) hidden w-(--filter-bar-width) max-w-(--filter-bar-width) min-w-(--filter-bar-width) shrink-0 flex-col gap-6 overflow-y-auto lg:flex hc-rail-max">
            {rightRail}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
