"use client";

import { useEffect, useRef } from "react";

const leaveCounts = new Map<string, number>();

export function useLeaveOnce(key: string, shouldEmit: () => boolean, onLeave: () => void): void {
  const emitted = useRef(false);
  const shouldRef = useRef(shouldEmit);
  shouldRef.current = shouldEmit;
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  useEffect(() => {
    leaveCounts.set(key, (leaveCounts.get(key) ?? 0) + 1);
    const fire = () => {
      if (emitted.current) return;
      if (!shouldRef.current()) return;
      emitted.current = true;
      onLeaveRef.current();
    };
    const onPageHide = () => fire();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      leaveCounts.set(key, (leaveCounts.get(key) ?? 1) - 1);
      queueMicrotask(() => {
        if ((leaveCounts.get(key) ?? 0) > 0) return;
        fire();
      });
    };
  }, [key]);
}
