"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { emit } from "@/services/vibeware/collector";
import { productRouteFromPathname, type ProductRoute } from "@/services/vibeware/route";
import { StorageService } from "@/services/StorageService";
import { useAuthStore } from "@/stores/authStore";
import { useInboxStore } from "@/stores/inboxStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { unreadLabel } from "@/lib/format";
import { hasIdentity, sessionCopy } from "@/lib/session-ui";
import { loadChannelRows, totalChannelUnread, useChannelsStore } from "@/stores/channelsStore";

const PRIMARY = [
  { href: "/chats", label: "Chats", prefix: "/chats", icon: IconChats },
  { href: "/channels", label: "Channels", prefix: "/channels", icon: IconChannels },
  { href: "/contacts", label: "Contacts", prefix: "/contacts", icon: IconContacts },
  { href: "/profile", label: "Profile", prefix: "/profile", icon: IconProfile },
] as const;

function isActive(pathname: string, href: string, prefix: string): boolean {
  return pathname === href || pathname.startsWith(`${prefix}/`);
}

function IconChats() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1z"
      />
    </svg>
  );
}

function IconChannels() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3 4 7v10l8 4 8-4V7l-8-4zm0 2.2 5.5 2.75L12 10.7 6.5 7.95 12 5.2zM6 9.3l5 2.5v7.1L6 16.4V9.3zm12 0v7.1l-5 2.5v-7.1l5-2.5z"
      />
    </svg>
  );
}

function IconContacts() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z"
      />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 5a3 3 0 1 1-3 3 3 3 0 0 1 3-3zm0 13.2a7.2 7.2 0 0 1-5.3-2.2 5.2 5.2 0 0 1 10.6 0A7.2 7.2 0 0 1 12 20.2z"
      />
    </svg>
  );
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

export function SiteNav() {
  const pathname = usePathname();
  const status = useSessionStatusStore((s) => s.status);
  const pubky = useAuthStore((s) => s.pubky);
  const pendingRequests = useInboxStore((s) => s.pendingRequests);
  const setPendingRequests = useInboxStore((s) => s.setPendingRequests);
  const channelRows = useChannelsStore((s) => s.rows);
  const setChannelRows = useChannelsStore((s) => s.setRows);
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
      .catch(() => {
        // list page owns the error surface
      });
  }, [pubky, pathname, setPendingRequests, setChannelRows]);

  if (pathname.startsWith("/e2e")) return null;

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
    <nav aria-label="Primary" className="w-full">
      <div className="hidden items-center gap-x-4 md:flex">
        {PRIMARY.map((link) => {
          const active = isActive(pathname, link.href, link.prefix);
          return (
            <Link
              key={link.href}
              href={link.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "inline-flex min-h-11 min-w-11 items-center font-semibold text-foreground underline underline-offset-4"
                  : "inline-flex min-h-11 min-w-11 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              }
            >
              {link.label}
              {link.label === "Chats" ? <NavBadge count={pendingRequests} testId="chatsNavBadge" /> : null}
              {link.label === "Channels" ? (
                <NavBadge count={channelUnread} testId="channelsNavBadge" />
              ) : null}
            </Link>
          );
        })}
        {sessionLink}
      </div>

      <div className="flex items-center justify-end md:hidden">{sessionLink}</div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background md:hidden">
        <ul className="mx-auto grid max-w-5xl grid-cols-4">
          {PRIMARY.map((link) => {
            const active = isActive(pathname, link.href, link.prefix);
            const Icon = link.icon;
            return (
              <li key={link.href}>
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
                  className={
                    active
                      ? "flex min-h-11 flex-col items-center justify-center gap-0.5 pt-1 hc-nav-label font-semibold text-foreground"
                      : "flex min-h-11 flex-col items-center justify-center gap-0.5 pt-1 hc-nav-label text-muted-foreground"
                  }
                >
                  <span className="relative">
                    <Icon />
                    {link.label === "Chats" && pendingRequests > 0 ? (
                      <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full hc-brand-dot" />
                    ) : null}
                    {link.label === "Channels" && channelUnread > 0 ? (
                      <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full hc-brand-dot" />
                    ) : null}
                  </span>
                  <span className="inline-flex items-center">
                    {link.label}
                    {link.label === "Chats" ? (
                      <NavBadge count={pendingRequests} testId="chatsNavBadge" />
                    ) : null}
                    {link.label === "Channels" ? (
                      <NavBadge count={channelUnread} testId="channelsNavBadge" />
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
