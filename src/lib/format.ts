import { PUBKY_ID_LENGTH } from "@/utils/pubkyId";

export function shortPubky(pubky: string): string {
  if (pubky.length <= 12) return pubky;
  return `${pubky.slice(0, 6)}…${pubky.slice(-4)}`;
}

export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function isLikelyPubkyLength(value: string): boolean {
  return value.length === PUBKY_ID_LENGTH;
}

export function unreadLabel(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}
