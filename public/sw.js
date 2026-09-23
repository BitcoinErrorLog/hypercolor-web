// v5: product-route shell, activate only after Reload.
const CACHE = "hypercolor-shell-v5";
const SHELL = [
  "/",
  "/chats",
  "/channels",
  "/contacts",
  "/requests",
  "/settings",
  "/profile",
  "/enable",
  "/discover",
  "/manifest.webmanifest",
  "/icon.svg",
];

function shellPath(url) {
  const path = url.pathname === "" ? "/" : url.pathname;
  return path;
}

function shouldCache(url) {
  if (url.origin !== self.location.origin) return false;
  const path = shellPath(url);
  if (path === "/e2e" || path.startsWith("/e2e/")) return false;
  return SHELL.includes(path);
}

function isNextRscRequest(request) {
  const url = new URL(request.url);
  if (url.searchParams.has("_rsc")) return true;
  if (url.pathname.endsWith(".txt")) return true;
  const rsc = request.headers.get("RSC") || request.headers.get("rsc");
  if (rsc === "1") return true;
  if (
    request.headers.get("Next-Router-State-Tree") ||
    request.headers.get("next-router-state-tree")
  ) {
    return true;
  }
  if (
    request.headers.get("Next-Router-Prefetch") ||
    request.headers.get("next-router-prefetch")
  ) {
    return true;
  }
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // Do not precache HTML routes. In webpack-dev that storms compiles,
      // corrupts Next JSON manifests, and leaves Flight waiting on HMR.
      // Cache documents only after a successful navigation (fetch handler).
      await Promise.all(
        ["/manifest.webmanifest", "/icon.svg"].map((url) =>
          cache.add(url).catch(() => undefined),
        ),
      );
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "hypercolor-skip-waiting") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type !== "hypercolor-sign-out") return;
  event.waitUntil(caches.delete(CACHE));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (isNextRscRequest(event.request)) return;
  if (event.request.mode !== "navigate" && event.request.destination !== "document") {
    return;
  }
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!shouldCache(url)) return;
  // Network-first, cache as offline fallback only. A cached document shell
  // references build-hashed chunks that the next deploy no longer serves, so
  // serving the cache first would re-break navigation the way v2 did.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        throw new Error("hypercolor: offline and no cached document for this route");
      }),
  );
});
