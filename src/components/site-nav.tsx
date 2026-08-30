"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

  return (
    <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.prefix}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
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
          className="text-brand underline-offset-4 hover:underline"
        >
          Connect
        </Link>
      ) : null}
    </nav>
  );
}
