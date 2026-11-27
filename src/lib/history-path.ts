/**
 * Notify React when the URL path changes, including Next.js client navigations.
 *
 * `popstate` only fires for Back/Forward. `history.pushState` / `replaceState`
 * (Next.js `<Link>` and `router.push`) do not. Linux WebKit also ignores
 * `History.prototype` wraps for native host calls and has no Navigation API.
 * Observe `window.location.pathname` via History wrapping, Navigation API
 * events, `popstate`, `hashchange`, `visibilitychange`, same-origin `<a>`
 * clicks, and a microtask-coalesced `MutationObserver` when Navigation API is
 * absent, keeping React synchronized without any `setInterval` polling.
 */

type HistoryMethod = "pushState" | "replaceState";

type NavigationHost = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

const listeners = new Set<() => void>();
let patched = false;
let lastObservedPath = "";
let mutationObserver: MutationObserver | null = null;
let mutationCheckScheduled = false;
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

function scheduleMutationCheck(): void {
  if (mutationCheckScheduled) return;
  mutationCheckScheduled = true;
  queueMicrotask(() => {
    mutationCheckScheduled = false;
    if (patched) notifyIfPathChanged();
  });
}

function onPopState(): void {
  notify();
}

function onCurrentEntryChange(): void {
  notifyIfPathChanged();
}

function onVisibilityChange(): void {
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    notifyIfPathChanged();
  }
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
  window.addEventListener("hashchange", onCurrentEntryChange);
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("visibilitychange", onVisibilityChange);
  const nav = navigationHost();
  if (nav) {
    nav.addEventListener("currententrychange", onCurrentEntryChange);
    nav.addEventListener("navigate", onCurrentEntryChange);
  } else if (typeof MutationObserver === "function" && document.documentElement) {
    mutationObserver = new MutationObserver(scheduleMutationCheck);
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
  patched = true;
}

function restore(): void {
  if (!patched) return;
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
  mutationCheckScheduled = false;
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
  window.removeEventListener("hashchange", onCurrentEntryChange);
  document.removeEventListener("click", onDocumentClick, true);
  document.removeEventListener("visibilitychange", onVisibilityChange);
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
