/**
 * Notify React when the URL path changes, including Next.js client navigations.
 *
 * `popstate` only fires for Back/Forward. `history.pushState` / `replaceState`
 * (Next.js `<Link>` and `router.push`) do not. Linux WebKit also drops
 * untrusted synthetic `PopStateEvent`s. Patching History is the store that
 * `usePathSegment` reads, because static-export rewrites leave
 * `window.location.pathname` as the real URL.
 */

type HistoryMethod = "pushState" | "replaceState";

const listeners = new Set<() => void>();
let patched = false;
const originals: { pushState: History["pushState"] | null; replaceState: History["replaceState"] | null } = {
  pushState: null,
  replaceState: null,
};

function notify(): void {
  for (const listener of listeners) listener();
}

function onPopState(): void {
  notify();
}

function wrap(method: HistoryMethod): void {
  const current = history[method];
  originals[method] = current;
  history[method] = function patchedHistory(
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    const ret = current.call(history, data, unused, url);
    notify();
    return ret;
  };
}

function ensurePatched(): void {
  if (patched) return;
  if (typeof window === "undefined" || typeof history === "undefined") return;
  wrap("pushState");
  wrap("replaceState");
  window.addEventListener("popstate", onPopState);
  patched = true;
}

function restore(): void {
  if (!patched) return;
  if (originals.pushState) history.pushState = originals.pushState;
  if (originals.replaceState) history.replaceState = originals.replaceState;
  originals.pushState = null;
  originals.replaceState = null;
  window.removeEventListener("popstate", onPopState);
  patched = false;
}

export function subscribeHistoryPath(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof history === "undefined") {
    return () => undefined;
  }
  ensurePatched();
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) restore();
  };
}

/** Test-only: drop listeners and native History methods. */
export function resetHistoryPathForTests(): void {
  listeners.clear();
  restore();
}

export function readWindowPathname(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.location.pathname;
  } catch {
    return "";
  }
}
