"use client";

import { useEffect, useState } from "react";
import { SQLITE_PERSIST_FAILED_EVENT } from "@/db/errors";
import {
  getTabLock,
  initTabLock,
  subscribeTabLock,
  type TabLock,
} from "@/services/tabLock";

export function TabLockReadonlyChip({ fixtureLock }: { fixtureLock?: TabLock } = {}) {
  const [lock, setLock] = useState<TabLock | null>(null);
  const [visible, setVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );

  useEffect(() => {
    let unsubscribe = () => {};
    void initTabLock().then((initial) => {
      setLock(initial);
      unsubscribe = subscribeTabLock(setLock);
    });
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const current = fixtureLock ?? lock ?? getTabLock();
  if (current.mode === "writer" || !visible) return null;

  return (
    <button
      type="button"
      data-testid="tabLockReadonlyChip"
      data-surface="tab-lock-chip"
      className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent/40"
      onClick={() => current.requestTakeover()}
    >
      Reading only — click to use this tab
    </button>
  );
}

export function TabLockBanner({ fixtureLock }: { fixtureLock?: TabLock } = {}) {
  const [persistError, setPersistError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe = () => {};
    void initTabLock().then(() => {
      unsubscribe = subscribeTabLock(() => undefined);
    });
    const onPersist = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setPersistError(detail || "Could not save the local database snapshot.");
    };
    window.addEventListener(SQLITE_PERSIST_FAILED_EVENT, onPersist);
    if (__HYPERCOLOR_E2E_HARNESS__) {
      const host = window as Window & {
        __hypercolorTryDbWrite?: () => Promise<{ ok: boolean; message: string }>;
      };
      host.__hypercolorTryDbWrite = async () => {
        const { getDb } = await import("@/db");
        try {
          (await getDb()).executeSync("DELETE FROM mesh_peers");
          return { ok: true, message: "ok" };
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : String(err) };
        }
      };
    }
    return () => {
      unsubscribe();
      window.removeEventListener(SQLITE_PERSIST_FAILED_EVENT, onPersist);
      if (__HYPERCOLOR_E2E_HARNESS__) {
        delete (window as Window & { __hypercolorTryDbWrite?: unknown }).__hypercolorTryDbWrite;
      }
    };
  }, [fixtureLock]);

  if (fixtureLock && fixtureLock.mode !== "writer") {
    return (
      <div data-surface="tab-lock-banner">
        <TabLockReadonlyChip fixtureLock={fixtureLock} />
      </div>
    );
  }

  if (!persistError) return null;

  return (
    <div
      role="status"
      className="border-b border-border hc-brand-banner px-6 py-3 text-sm text-card-foreground"
      data-surface="tab-lock-banner"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
        <p className="w-full break-words">{persistError}</p>
      </div>
    </div>
  );
}
