"use client";

import { useSyncExternalStore } from "react";
import { subscribeHistoryPath, readWindowPathname } from "@/lib/history-path";
import { readPathId, type AppPathSegment } from "@/lib/path-id";

export function usePathSegment(segment: AppPathSegment): string | null {
  return useSyncExternalStore(
    subscribeHistoryPath,
    () => readPathId(segment, readWindowPathname()),
    () => null,
  );
}
