export const PRODUCT_ROUTES = [
  "welcome",
  "enable",
  "chats",
  "chat",
  "channels",
  "channel",
  "contacts",
  "contact",
  "requests",
  "profile",
  "settings",
  "ring-callback",
] as const;

export type ProductRoute = (typeof PRODUCT_ROUTES)[number];

export function productRouteFromPathname(pathname: string): ProductRoute | null {
  if (pathname.startsWith("/e2e")) return null;
  if (pathname === "/") return "welcome";
  if (pathname === "/enable" || pathname === "/enable/") return "enable";
  if (pathname === "/chats" || pathname === "/chats/") return "chats";
  if (pathname.startsWith("/chats/")) return "chat";
  if (pathname === "/channels" || pathname === "/channels/") return "channels";
  if (pathname.startsWith("/channels/")) return "channel";
  if (pathname === "/contacts" || pathname === "/contacts/") return "contacts";
  if (pathname.startsWith("/contacts/")) return "contact";
  if (pathname === "/requests" || pathname === "/requests/") return "requests";
  if (pathname === "/profile" || pathname === "/profile/") return "profile";
  if (pathname === "/settings" || pathname === "/settings/") return "settings";
  if (pathname === "/ring-callback" || pathname === "/ring-callback/") return "ring-callback";
  return null;
}
