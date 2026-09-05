"use client";

import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  IconHash,
  IconHome,
  IconInbox,
  IconMessageCircle,
  IconSettings,
  IconUsers,
} from "@/components/ui/icons";

export type ShellNavId = "chats" | "contacts" | "channels" | "requests" | "settings" | "home";

const NAV: { id: ShellNavId; label: string; icon: ComponentType<{ className?: string; size?: number }> }[] = [
  { id: "home", label: "Home", icon: IconHome },
  { id: "chats", label: "Chats", icon: IconMessageCircle },
  { id: "contacts", label: "Contacts", icon: IconUsers },
  { id: "channels", label: "Channels", icon: IconHash },
  { id: "requests", label: "Requests", icon: IconInbox },
  { id: "settings", label: "Settings", icon: IconSettings },
];

export function AppShell({
  title,
  active,
  selfPubky,
  leftRail,
  rightRail,
  children,
  hideChrome = false,
  fillViewport = false,
  centerColumn = false,
}: {
  title: string;
  active: ShellNavId;
  selfPubky: string;
  leftRail?: ReactNode;
  rightRail?: ReactNode;
  children: ReactNode;
  hideChrome?: boolean;
  fillViewport?: boolean;
  centerColumn?: boolean;
}) {
  return (
    <div
      className={cn("min-h-svh bg-background text-foreground", fillViewport && "flex h-svh flex-col overflow-hidden")}
      style={{ fontFamily: "var(--font-inter-tight), 'Inter Tight', sans-serif" }}
    >
      {!hideChrome ? (
        <header className="pointer-events-none sticky top-0 z-(--z-sticky-header) hidden w-full shrink-0 bg-linear-to-b from-(--background) from-50% to-transparent hc-header-iridescent p-0 sm:py-6 lg:block">
          <nav className="pointer-events-auto mx-auto flex h-24 w-full max-w-(--container-max-width) flex-row items-center justify-between gap-6 px-4 p-6 lg:px-6 xl:px-0">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <div className="flex items-center gap-3">
              {NAV.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === active;
                return (
                  <Button
                    key={item.id}
                    type="button"
                    variant="secondary"
                    size="icon"
                    aria-label={item.label}
                    aria-current={isActive ? "page" : undefined}
                    className={cn("h-12 w-12 backdrop-blur-md", isActive ? "" : "border bg-white/5")}
                  >
                    <Icon className="size-6" />
                  </Button>
                );
              })}
              <span className="relative inline-flex shrink-0">
                <Avatar seed={selfPubky} size="lg" ring />
                <Badge className="absolute -right-1 -bottom-1 size-4 rounded-full p-0" />
              </span>
            </div>
          </nav>
        </header>
      ) : null}

      {!hideChrome ? (
        <header className="sticky top-0 z-(--z-mobile-menu) flex h-16 shrink-0 items-center justify-between bg-background px-4 lg:hidden">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <span className="inline-flex shrink-0">
            <Avatar seed={selfPubky} size="lg" ring />
          </span>
        </header>
      ) : null}

      <div
        className={cn(
          "mx-auto flex w-full min-w-0 max-w-(--container-max-width) px-4 lg:px-6 xl:px-0",
          hideChrome && "min-h-svh w-full flex-col justify-center py-8",
          fillViewport && !hideChrome && "flex min-h-0 flex-1 items-stretch gap-6 overflow-hidden pb-28 lg:pb-0",
          !fillViewport && !hideChrome && "flex flex-1 gap-6 pb-28 lg:pb-10",
        )}
      >
        {leftRail ? (
          <aside
            className="sticky top-(--header-offset-main) hidden w-(--filter-bar-width) max-w-(--filter-bar-width) min-w-(--filter-bar-width) shrink-0 flex-col gap-6 overflow-y-auto lg:flex"
            style={{ maxHeight: "calc(100svh - var(--header-offset-main))" }}
          >
            {leftRail}
          </aside>
        ) : null}
        <main
          className={cn(
            "min-w-0",
            hideChrome && "mx-auto w-full max-w-3xl flex-none",
            !hideChrome && !centerColumn && "flex-1",
            fillViewport && !centerColumn && "flex h-full min-h-0 flex-col overflow-y-auto",
            centerColumn && "mx-auto flex h-full w-full max-w-3xl flex-col justify-center py-8",
          )}
        >
          {children}
        </main>
        {rightRail ? (
          <aside
            className="sticky top-(--header-offset-main) hidden w-(--filter-bar-width) max-w-(--filter-bar-width) min-w-(--filter-bar-width) shrink-0 flex-col gap-6 overflow-y-auto lg:flex"
            style={{ maxHeight: "calc(100svh - var(--header-offset-main))" }}
          >
            {rightRail}
          </aside>
        ) : null}
      </div>

      {!hideChrome ? (
        <nav
          className="fixed inset-x-0 bottom-0 z-(--z-mobile-menu) bg-linear-to-t from-background via-background/95 to-transparent px-3 py-4 lg:hidden"
          aria-label="Primary"
        >
          <div className="mx-auto flex w-full max-w-[380px] items-center justify-between rounded-full p-3 sm:max-w-[600px] md:max-w-[720px]">
            {NAV.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === active;
              return (
                <Button
                  key={item.id}
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={item.label}
                  className={cn(
                    "h-12 w-12 shrink-0 rounded-full border-0 shadow-none",
                    isActive ? "bg-secondary" : "border border-border bg-white/5 backdrop-blur-sm",
                  )}
                >
                  <Icon className="h-6 w-6" />
                </Button>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
