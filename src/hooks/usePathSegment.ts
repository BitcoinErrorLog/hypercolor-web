"use client";

import { useSyncExternalStore } from "react";
import { readPathId, type AppPathSegment } from "@/lib/path-id";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

export function usePathSegment(segment: AppPathSegment): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readPathId(segment, window.location.pathname),
    () => null,
  );
}
