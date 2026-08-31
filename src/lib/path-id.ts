export type AppPathSegment = "chats" | "channels" | "contacts";

/**
 * Same-document path change. Next patches `history.pushState` and, unless
 * `data.__NA` is set, dispatches ACTION_RESTORE — which starts Flight and
 * waits on webpack HMR (`app-router.js` pushState patch). After Enable that
 * Flight never commits, so Open chats stayed on `/enable`.
 */
export function pushAppPath(href: string): void {
  window.history.pushState({ __NA: true }, "", href);
  window.dispatchEvent(new Event("popstate"));
}

export function readPathId(segment: AppPathSegment, pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== segment || !parts[1]) return null;
  try {
    return decodeURIComponent(parts[1]);
  } catch {
    return parts[1];
  }
}
