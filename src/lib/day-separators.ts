export type DayBucket<T> =
  | { kind: "separator"; key: string; label: string }
  | { kind: "item"; key: string; item: T };

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDayLabel(ms: number, now = Date.now()): string {
  const day = dayKey(ms);
  const today = dayKey(now);
  const yesterday = dayKey(now - 24 * 60 * 60 * 1000);
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function withDaySeparators<T extends { sentAt: number; eventId: string }>(
  items: readonly T[],
  now = Date.now(),
): DayBucket<T>[] {
  const out: DayBucket<T>[] = [];
  let last: string | null = null;
  for (const item of items) {
    const key = dayKey(item.sentAt);
    if (key !== last) {
      out.push({ kind: "separator", key: `day:${key}`, label: formatDayLabel(item.sentAt, now) });
      last = key;
    }
    out.push({ kind: "item", key: item.eventId, item });
  }
  return out;
}
