export type AppPathSegment = "chats" | "channels" | "contacts";

/**
 * Same-document path change. Next patches `history.pushState` and, unless
 * `data.__NA` is set, dispatches ACTION_RESTORE — which starts Flight and
 * waits on webpack HMR (`app-router.js` pushState patch). After Enable that
 * Flight never commits, so Open chats stayed on `/enable`.
 *
 * `stampAppPath` writes history only. A synthetic `popstate` can still re-enter
 * Next restore; Enable uses this after chats are already mounted in-place.
 * `pushAppPath` also dispatches `popstate` so `usePathSegment` updates.
 */
export function stampAppPath(href: string): void {
  window.history.pushState({ __NA: true }, "", href);
}

export function pushAppPath(href: string): void {
  stampAppPath(href);
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
