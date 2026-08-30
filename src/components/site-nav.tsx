import Link from "next/link";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/chats", label: "Chats" },
  { href: "/contacts", label: "Contacts" },
  { href: "/requests", label: "Requests" },
  { href: "/channels", label: "Channels" },
  { href: "/enable", label: "Enable" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
] as const;

export function SiteNav() {
  return (
    <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
