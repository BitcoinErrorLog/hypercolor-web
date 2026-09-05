"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SQLITE_PERSIST_FAILED_EVENT } from "@/db/errors";
import {
  getTabLock,
  initTabLock,
  subscribeTabLock,
  type TabLock,
} from "@/services/tabLock";

export function TabLockBanner({ fixtureLock }: { fixtureLock?: TabLock } = {}) {
  const [lock, setLock] = useState<TabLock | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [writeDenied, setWriteDenied] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe = () => {};
    void initTabLock().then((initial) => {
      setLock(initial);
      unsubscribe = subscribeTabLock(setLock);
    });
    const onPersist = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setPersistError(detail || "Could not save the local database snapshot.");
    };
    const onWriteDenied = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setWriteDenied(detail);
    };
    window.addEventListener(SQLITE_PERSIST_FAILED_EVENT, onPersist);
    window.addEventListener("hypercolor-readonly-write", onWriteDenied);
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
      window.removeEventListener("hypercolor-readonly-write", onWriteDenied);
      if (__HYPERCOLOR_E2E_HARNESS__) {
        delete (window as Window & { __hypercolorTryDbWrite?: unknown }).__hypercolorTryDbWrite;
      }
    };
  }, []);

  const current = fixtureLock ?? lock ?? getTabLock();
  if (current.mode === "writer" && !persistError) return null;

  return (
    <div
      role="status"
      className="border-b border-border bg-brand/8 px-6 py-3 text-sm text-card-foreground"
      data-surface="tab-lock-banner"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
        {current.mode !== "writer" ? (
          <>
            <p>
              This tab cannot write. Reads still work. Hypercolor is also open in
              another tab.
            </p>
            <Button type="button" size="sm" onClick={() => current.requestTakeover()}>
              Take over writing here
            </Button>
          </>
        ) : null}
        {writeDenied ? (
          <p className="w-full" data-testid="readonlyWriteError">
            {writeDenied}
          </p>
        ) : null}
        {persistError ? <p className="w-full break-words">{persistError}</p> : null}
      </div>
    </div>
  );
}
