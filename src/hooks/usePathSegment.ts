"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { subscribeHistoryPath, readWindowPathname } from "@/lib/history-path";
import { readPathId, type AppPathSegment } from "@/lib/path-id";

export function usePathSegment(segment: AppPathSegment): string | null {
  // Next client navigations re-render this hook even when Linux WebKit
  // ignores a History wrap. The id still comes from window.location because
  // static-export rewrites can leave usePathname() on the list path.
  usePathname();
  return useSyncExternalStore(
    subscribeHistoryPath,
    () => readPathId(segment, readWindowPathname()),
    () => null,
  );
}
