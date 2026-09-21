/**
 * Notify React when the URL path changes, including Next.js client navigations.
 *
 * `popstate` only fires for Back/Forward. `history.pushState` / `replaceState`
 * (Next.js `<Link>` and `router.push`) do not. Linux WebKit also drops
 * untrusted synthetic `PopStateEvent`s, and its native History methods are
 * host objects: wrapping `History.prototype` is a no-op for the engine's own
 * calls. Observe `window.location.pathname` itself: wrap when the engine
 * honours it, Navigation API, and same-origin `<a>` clicks so React still
 * follows native `pushState`. Static-export rewrites leave
 * `window.location.pathname` as the real URL.
 */

type HistoryMethod = "pushState" | "replaceState";

type NavigationHost = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

const listeners = new Set<() => void>();
let patched = false;
let lastObservedPath = "";
let pathWatchTimer: ReturnType<typeof setInterval> | 0 = 0;
const originals: { pushState: History["pushState"] | null; replaceState: History["replaceState"] | null } = {
  pushState: null,
  replaceState: null,
};

function notify(): void {
  lastObservedPath = readWindowPathname();
  for (const listener of listeners) listener();
}

function notifyIfPathChanged(): void {
  const next = readWindowPathname();
  if (next === lastObservedPath) return;
  notify();
}

function onPopState(): void {
  notify();
}

function onCurrentEntryChange(): void {
  notifyIfPathChanged();
}

function isSameOriginAppLink(anchor: HTMLAnchorElement): boolean {
  if (anchor.hasAttribute("download")) return false;
  const target = anchor.getAttribute("target");
  if (target && target !== "" && target !== "_self") return false;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) {
    return false;
  }
  try {
    const url = new URL(anchor.href, window.location.href);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function onDocumentClick(event: Event): void {
  const eventTarget = event.target;
  if (!(eventTarget instanceof Element)) return;
  const anchor = eventTarget.closest("a");
  if (!(anchor instanceof HTMLAnchorElement) || !isSameOriginAppLink(anchor)) return;
  queueMicrotask(notifyIfPathChanged);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(notifyIfPathChanged);
  }
}

function navigationHost(): NavigationHost | null {
  if (typeof window === "undefined") return null;
  const nav = (window as Window & { navigation?: NavigationHost }).navigation;
  if (!nav || typeof nav.addEventListener !== "function") return null;
  return nav;
}

function methodStillNative(method: HistoryMethod): boolean {
  try {
    return Function.prototype.toString.call(History.prototype[method]).includes("[native code]");
  } catch {
    return true;
  }
}

function armPathWatch(): void {
  if (pathWatchTimer) return;
  pathWatchTimer = setInterval(notifyIfPathChanged, 50);
}

function disarmPathWatch(): void {
  if (pathWatchTimer) clearInterval(pathWatchTimer);
  pathWatchTimer = 0;
}

function installMethod(
  target: object,
  method: HistoryMethod,
  wrapped: History["pushState"],
): void {
  try {
    Object.defineProperty(target, method, {
      configurable: true,
      writable: true,
      value: wrapped,
    });
  } catch {
    (target as History)[method] = wrapped;
  }
}

function wrap(method: HistoryMethod): void {
  const proto = History.prototype;
  const current = proto[method];
  originals[method] = current;
  const wrapped: History["pushState"] = function patchedHistory(
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    const ret = current.call(this, data, unused, url);
    notify();
    return ret;
  };
  installMethod(proto, method, wrapped);
  if (typeof history !== "undefined" && history[method] !== wrapped) {
    installMethod(history, method, wrapped);
  }
}

function restoreMethod(target: object, method: HistoryMethod, original: History["pushState"]): void {
  try {
    Object.defineProperty(target, method, {
      configurable: true,
      writable: true,
      value: original,
    });
  } catch {
    (target as History)[method] = original;
  }
}

function ensurePatched(): void {
  if (patched) return;
  if (typeof window === "undefined" || typeof history === "undefined") return;
  if (typeof History === "undefined" || typeof History.prototype === "undefined") return;
  lastObservedPath = readWindowPathname();
  wrap("pushState");
  wrap("replaceState");
  window.addEventListener("popstate", onPopState);
  document.addEventListener("click", onDocumentClick, true);
  const nav = navigationHost();
  nav?.addEventListener("currententrychange", onCurrentEntryChange);
  nav?.addEventListener("navigate", onCurrentEntryChange);
  if (methodStillNative("pushState") || methodStillNative("replaceState")) {
    armPathWatch();
  }
  patched = true;
}

function restore(): void {
  if (!patched) return;
  disarmPathWatch();
  if (originals.pushState) {
    restoreMethod(History.prototype, "pushState", originals.pushState);
    if (typeof history !== "undefined") {
      restoreMethod(history, "pushState", originals.pushState);
    }
  }
  if (originals.replaceState) {
    restoreMethod(History.prototype, "replaceState", originals.replaceState);
    if (typeof history !== "undefined") {
      restoreMethod(history, "replaceState", originals.replaceState);
    }
  }
  originals.pushState = null;
  originals.replaceState = null;
  window.removeEventListener("popstate", onPopState);
  document.removeEventListener("click", onDocumentClick, true);
  const nav = navigationHost();
  nav?.removeEventListener("currententrychange", onCurrentEntryChange);
  nav?.removeEventListener("navigate", onCurrentEntryChange);
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
