"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "hc-enable-done";
const GLOBAL_KEY = "__hypercolorEnableDone";

type EnableDoneState = {
  pubky: string | null;
  listeners: Set<() => void>;
};

type EnableDoneGlobal = typeof globalThis & {
  [GLOBAL_KEY]?: EnableDoneState;
};

function state(): EnableDoneState {
  const g = globalThis as EnableDoneGlobal;
  g[GLOBAL_KEY] ??= { pubky: null, listeners: new Set() };
  return g[GLOBAL_KEY];
}

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStored(pubky: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (pubky) window.sessionStorage.setItem(STORAGE_KEY, pubky);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode still keeps the in-memory flag for this document.
  }
}

function writeDataset(pubky: string | null): void {
  if (typeof document === "undefined") return;
  if (pubky) document.documentElement.dataset.hcEnable = "enabled";
  else delete document.documentElement.dataset.hcEnable;
}

function notify(): void {
  for (const listener of state().listeners) listener();
}

function currentPubky(): string | null {
  return state().pubky || readStored();
}

export function getEnableCompletedPubky(): string | null {
  return currentPubky();
}

export function isEnableCompleted(): boolean {
  return currentPubky() !== null;
}

export function markEnableCompleted(pubky: string): void {
  state().pubky = pubky;
  writeStored(pubky);
  writeDataset(pubky);
  notify();
}

export function clearEnableCompleted(): void {
  state().pubky = null;
  writeStored(null);
  writeDataset(null);
  notify();
}

function subscribeEnableCompleted(listener: () => void): () => void {
  state().listeners.add(listener);
  return () => {
    state().listeners.delete(listener);
  };
}

export function useEnableCompleted(): boolean {
  const [done, setDone] = useState(() => isEnableCompleted());
  useEffect(() => {
    const sync = () => setDone(currentPubky() !== null);
    sync();
    return subscribeEnableCompleted(sync);
  }, []);
  return done;
}

export function useEnableCompletedPubky(): string | null {
  const [pubky, setPubky] = useState<string | null>(() => currentPubky());
  useEffect(() => {
    const sync = () => setPubky(currentPubky());
    sync();
    return subscribeEnableCompleted(sync);
  }, []);
  return pubky;
}
