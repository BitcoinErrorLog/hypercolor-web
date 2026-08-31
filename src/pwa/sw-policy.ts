/**
 * Service-worker fetch policy for the Hypercolor shell.
 *
 * Next's App Router client navigation fetches the same path as the document
 * (`/chats`) with `RSC: 1` / `_rsc`. A cache-first worker that stored the
 * HTML document for that URL returns `text/html` to the Flight client, which
 * then never commits the transition (see `fetch-server-response.js`).
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
