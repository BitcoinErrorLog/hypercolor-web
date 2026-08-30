const CACHE = "hypercolor-shell-v1";
const SHELL = [
  "/",
  "/chats",
  "/channels",
  "/contacts",
  "/requests",
  "/settings",
  "/profile",
  "/enable",
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

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
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
  if (event.data?.type !== "hypercolor-sign-out") return;
  event.waitUntil(caches.delete(CACHE));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request)
        .then((response) => {
          if (response.ok && shouldCache(url)) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? fetched;
    }),
  );
});
