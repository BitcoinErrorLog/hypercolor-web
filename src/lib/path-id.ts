export type AppPathSegment = "chats" | "channels" | "contacts" | "discover";

export function readPathId(segment: AppPathSegment, pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== segment || !parts[1]) return null;
  try {
    return decodeURIComponent(parts[1]);
  } catch {
    return parts[1];
  }
}
