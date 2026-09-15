/**
 * Service-worker fetch policy for the Hypercolor shell.
 *
 * Next's App Router client navigation fetches the same path as the document
 * (`/chats`) with `RSC: 1` / `_rsc`. The v2 worker matched shell paths by
 * pathname while keying the cache by full URL, so Flight responses were stored
 * under `/chats?_rsc=<hash>` and then served cache-first forever. After a
 * redeploy that payload still referenced the previous build's chunks, so the
 * client transition never committed.
 *
 * The policy is therefore: never intercept Flight/RSC requests, intercept only
 * top-level document navigations for known shell routes, and serve those
 * network-first with the cache as an offline fallback only.
 */

export type FetchLike = {
  url: string;
  method?: string;
  mode?: string;
  destination?: string;
  headers: { get(name: string): string | null };
};

export function isNextRscRequest(request: FetchLike): boolean {
  let url: URL;
  try {
    url = new URL(request.url, "http://localhost");
  } catch {
    return false;
  }
  if (url.searchParams.has("_rsc")) return true;
  if (url.pathname.endsWith(".txt")) return true;
  const rsc = request.headers.get("RSC") ?? request.headers.get("rsc");
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

export function shouldInterceptForShellCache(request: FetchLike): boolean {
  if ((request.method ?? "GET") !== "GET") return false;
  if (isNextRscRequest(request)) return false;
  return request.mode === "navigate" || request.destination === "document";
}
