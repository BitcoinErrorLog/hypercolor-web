"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { emit } from "@/services/vibeware/collector";
import { productRouteFromPathname, type ProductRoute } from "@/services/vibeware/route";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { hasIdentity } from "@/lib/session-ui";

const LINKS = [
  { href: "/chats", label: "Chats", prefix: "/chats" },
  { href: "/channels", label: "Channels", prefix: "/channels" },
  { href: "/contacts", label: "Contacts", prefix: "/contacts" },
  { href: "/requests", label: "Requests", prefix: "/requests" },
  { href: "/profile", label: "Profile", prefix: "/profile" },
  { href: "/settings", label: "Settings", prefix: "/settings" },
] as const;

export function SiteNav() {
  const pathname = usePathname();
  const status = useSessionStatusStore((s) => s.status);
  const showEnable = hasIdentity(status) && status.kind !== "enabled";
  const fromRoute = useRef<ProductRoute | null>(null);

  useEffect(() => {
    const route = productRouteFromPathname(pathname);
    if (!route) return;
    const previous = fromRoute.current;
    fromRoute.current = route;
    void emit("app.route.viewed", { route, from_route: previous ?? "none" });
  }, [pathname]);

  if (pathname.startsWith("/e2e")) return null;

  return (
    <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.prefix}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            prefetch={false}
            className={
              active
                ? "text-foreground underline underline-offset-4"
                : "text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            }
          >
            {link.label}
          </Link>
        );
      })}
      {showEnable ? (
        <Link
          href="/enable"
          prefetch={false}
          className={
            pathname === "/enable"
              ? "text-brand underline underline-offset-4"
              : "text-brand underline-offset-4 hover:underline"
          }
        >
          Enable
        </Link>
      ) : null}
      {!hasIdentity(status) ? (
        <Link
          href="/"
          prefetch={false}
          className="text-brand underline-offset-4 hover:underline"
        >
          Connect
        </Link>
      ) : null}
    </nav>
  );
}
