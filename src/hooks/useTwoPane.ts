"use client";

import { useSyncExternalStore } from "react";

const MD_UP = "(min-width: 768px)";

/** Desktop two-pane is client-only. SSR / hydration snapshot is false (mobile `h1`). */
export function useTwoPane(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(MD_UP);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(MD_UP).matches,
    () => false,
  );
}
