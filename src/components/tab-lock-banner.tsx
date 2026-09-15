"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  getTabLock,
  initTabLock,
  subscribeTabLock,
  type TabLock,
} from "@/services/tabLock";

export function TabLockBanner() {
  const [lock, setLock] = useState<TabLock | null>(null);

  useEffect(() => {
    let unsubscribe = () => {};
    void initTabLock().then((initial) => {
      setLock(initial);
      unsubscribe = subscribeTabLock(setLock);
    });
    return () => unsubscribe();
  }, []);

  const current = lock ?? getTabLock();
  if (current.mode === "writer") return null;

  return (
    <div
      role="status"
      className="border-b border-border bg-card px-6 py-3 text-sm text-card-foreground"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
        <p>Hypercolor is open in another tab — take over?</p>
        <Button type="button" size="sm" onClick={() => current.requestTakeover()}>
          Take over
        </Button>
      </div>
    </div>
  );
}
