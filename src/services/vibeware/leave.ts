"use client";

import { useEffect, useEffectEvent, useRef } from "react";

const leaveCounts = new Map<string, number>();

export function useLeaveOnce(key: string, shouldEmit: () => boolean, onLeave: () => void): void {
  const emitted = useRef(false);
  const latestShouldEmit = useEffectEvent(shouldEmit);
  const latestOnLeave = useEffectEvent(onLeave);

  useEffect(() => {
    leaveCounts.set(key, (leaveCounts.get(key) ?? 0) + 1);
    const fire = () => {
      if (emitted.current) return;
      if (!latestShouldEmit()) return;
      emitted.current = true;
      latestOnLeave();
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
