/**
 * Notify React when the URL path changes, including Next.js client navigations.
 *
 * `popstate` only fires for Back/Forward. `history.pushState` / `replaceState`
 * (Next.js `<Link>` and `router.push`) do not. Linux WebKit also drops
 * untrusted synthetic `PopStateEvent`s, and `history.pushState` on that
 * engine is the prototype method — an instance wrap is a no-op. Patch
 * `History.prototype` (and the instance if it still diverges) so
 * `usePathSegment` sees `page.evaluate` and Next client navigations.
 * Static-export rewrites leave `window.location.pathname` as the real URL.
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
  wrap("pushState");
  wrap("replaceState");
  window.addEventListener("popstate", onPopState);
  patched = true;
}

function restore(): void {
  if (!patched) return;
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
