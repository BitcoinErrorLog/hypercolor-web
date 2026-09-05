"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IconHash, IconHome, IconInbox, IconMessageCircle, IconSettings, IconUsers } from "@/components/ui/icons";
import { unreadLabel } from "@/lib/format";
import { hasIdentity, sessionCopy } from "@/lib/session-ui";
import { emit } from "@/services/vibeware/collector";
import { productRouteFromPathname, type ProductRoute } from "@/services/vibeware/route";
import { StorageService } from "@/services/StorageService";
import { useAuthStore } from "@/stores/authStore";
import { useInboxStore } from "@/stores/inboxStore";
import { useSessionStatusStore, type SessionUiStatus } from "@/stores/sessionStatusStore";
import { loadChannelRows, totalChannelUnread, useChannelsStore } from "@/stores/channelsStore";

const PRIMARY = [
  { href: "/", label: "Home", prefix: "/", icon: IconHome, exact: true },
  { href: "/chats", label: "Chats", prefix: "/chats", icon: IconMessageCircle },
  { href: "/contacts", label: "Contacts", prefix: "/contacts", icon: IconUsers },
  { href: "/channels", label: "Channels", prefix: "/channels", icon: IconHash },
  { href: "/requests", label: "Requests", prefix: "/requests", icon: IconInbox },
  { href: "/settings", label: "Settings", prefix: "/settings", icon: IconSettings },
] as const;

function isActive(pathname: string, href: string, prefix: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${prefix}/`);
}

function NavBadge({ count, testId }: { count: number; testId: string }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full hc-brand-fill px-1 hc-meta font-medium"
      data-testid={testId}
    >
      {unreadLabel(count)}
    </span>
  );
}

export function SiteNav({
  fixturePathname,
  fixtureStatus,
  fixturePendingRequests,
}: {
  fixturePathname?: string;
  fixtureStatus?: SessionUiStatus;
  fixturePendingRequests?: number;
} = {}) {
  const routePathname = usePathname();
  const pathname = fixturePathname ?? routePathname ?? "/";
  const storedStatus = useSessionStatusStore((s) => s.status);
  const status = fixtureStatus ?? storedStatus;
  const pubky = useAuthStore((s) => s.pubky);
  const storedPendingRequests = useInboxStore((s) => s.pendingRequests);
  const setPendingRequests = useInboxStore((s) => s.setPendingRequests);
  const channelRows = useChannelsStore((s) => s.rows);
  const setChannelRows = useChannelsStore((s) => s.setRows);
  const pendingRequests = fixturePendingRequests ?? storedPendingRequests;
  const channelUnread = totalChannelUnread(channelRows);
  const showEnable = hasIdentity(status) && status.kind !== "enabled";
  const copy = sessionCopy(status);
  const fromRoute = useRef<ProductRoute | null>(null);

  useEffect(() => {
    const route = productRouteFromPathname(pathname);
    if (!route) return;
    const previous = fromRoute.current;
    fromRoute.current = route;
    void emit("app.route.viewed", { route, from_route: previous ?? "none" });
  }, [pathname]);

  useEffect(() => {
    if (!pubky) return;
    void StorageService.countPendingMessageRequests(pubky).then((count) => {
      setPendingRequests(count);
    });
    void loadChannelRows(pubky)
      .then((rows) => {
        setChannelRows(rows);
      })
      .catch(() => undefined);
  }, [pubky, pathname, setPendingRequests, setChannelRows]);

  if (pathname.startsWith("/e2e") && !fixturePathname) return null;

  const sessionLink =
    !hasIdentity(status) ? (
      <Link
        href="/"
        prefetch={false}
        className="inline-flex min-h-11 items-center text-sm font-medium hc-brand-text underline-offset-4 hover:underline"
      >
        Connect
      </Link>
    ) : showEnable && copy.primaryHref ? (
      <Link
        href={copy.primaryHref}
        prefetch={false}
        className={
          pathname === "/enable"
            ? "inline-flex min-h-11 items-center text-sm font-medium hc-brand-text underline underline-offset-4"
            : "inline-flex min-h-11 items-center text-sm font-medium hc-brand-text underline-offset-4 hover:underline"
        }
      >
        Enable
      </Link>
    ) : null;

  return (
    <>
      <nav aria-label="Primary" className="hidden items-center gap-3 lg:flex" data-surface="site-nav">
        {PRIMARY.map((link) => {
          const active = isActive(pathname, link.href, link.prefix, "exact" in link ? Boolean(link.exact) : false);
          const Icon = link.icon;
          return (
            <Button key={link.href} asChild variant="secondary" size="icon" className={cn("hc-nav-circle", active ? "" : "hc-nav-circle-idle")}>
              <Link
                href={link.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                aria-label={
                  link.label === "Chats" && pendingRequests > 0
                    ? `Chats, ${pendingRequests} message requests`
                    : link.label === "Channels" && channelUnread > 0
                      ? `Channels, ${channelUnread} unread`
                      : link.label
                }
              >
                <Icon className="size-6" />
                <span className="sr-only">
                  {link.label}
                  {link.label === "Chats" ? <NavBadge count={pendingRequests} testId="chatsNavBadge" /> : null}
                  {link.label === "Channels" ? (
                    <NavBadge count={channelUnread} testId="channelsNavBadge" />
                  ) : null}
                </span>
              </Link>
            </Button>
          );
        })}
        {sessionLink}
        {pubky ? (
          <Link href="/profile" prefetch={false} aria-label="Profile">
            <span className="relative inline-flex shrink-0">
              <Avatar seed={pubky} size="lg" ring />
            </span>
          </Link>
        ) : null}
      </nav>

      <div className="flex items-center justify-end gap-3 lg:hidden">
        {sessionLink}
        {pubky ? (
          <Link href="/profile" prefetch={false} aria-label="Profile" className="inline-flex shrink-0">
            <Avatar seed={pubky} size="lg" ring />
          </Link>
        ) : null}
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-(--z-mobile-menu) bg-linear-to-t from-background via-background/95 to-transparent px-3 py-4 lg:hidden"
        aria-label="Primary"
        data-surface="site-nav-mobile"
      >
        <ul className="mx-auto flex w-full hc-mobile-nav-max items-center justify-between rounded-full p-3">
          {PRIMARY.map((link) => {
            const active = isActive(pathname, link.href, link.prefix, "exact" in link ? Boolean(link.exact) : false);
            const Icon = link.icon;
            return (
              <li key={link.href}>
                <Button asChild size="icon" variant="ghost" className={cn("hc-nav-circle", active ? "bg-secondary" : "hc-nav-circle-idle")}>
                  <Link
                    href={link.href}
                    prefetch={false}
                    aria-current={active ? "page" : undefined}
                    aria-label={
                      link.label === "Chats" && pendingRequests > 0
                        ? `Chats, ${pendingRequests} message requests`
                        : link.label === "Channels" && channelUnread > 0
                          ? `Channels, ${channelUnread} unread`
                          : link.label
                    }
                  >
                    <span className="relative">
                      <Icon className="h-6 w-6" />
                      {link.label === "Chats" && pendingRequests > 0 ? (
                        <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full hc-brand-dot" />
                      ) : null}
                      {link.label === "Channels" && channelUnread > 0 ? (
                        <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full hc-brand-dot" />
                      ) : null}
                    </span>
                    <span className="sr-only">
                      {link.label}
                      {link.label === "Chats" ? <NavBadge count={pendingRequests} testId="chatsNavBadge" /> : null}
                      {link.label === "Channels" ? (
                        <NavBadge count={channelUnread} testId="channelsNavBadge" />
                      ) : null}
                    </span>
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
