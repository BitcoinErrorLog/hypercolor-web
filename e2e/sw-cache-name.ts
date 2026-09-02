import { readFileSync } from "node:fs";

/** Parse the CACHE constant from a service-worker source. Single source of truth. */
export function cacheNameFromWorkerSource(source: string): string {
  const match = source.match(/^\s*const CACHE = "([^"]+)";/m);
  if (!match?.[1]) {
    throw new Error("service worker source is missing a CACHE string constant");
  }
  return match[1];
}

export function cacheNameFromWorkerFile(file: string): string {
  return cacheNameFromWorkerSource(readFileSync(file, "utf8"));
}
