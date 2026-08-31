"use client";

import { useStore, type UseBoundStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  clearEnableCompleted,
  getEnableCompletedPubky,
  isEnableCompleted,
  markEnableCompleted,
} from "@/lib/enable-done";
import type { EnableStatus } from "@/services/link/session";

export type SessionUiStatus =
  | { kind: "unknown" }
  | { kind: "no-identity" }
  | { kind: "needs-enable" }
  | { kind: "session-offline"; pubky: string }
  | { kind: "live"; pubky: string }
  | { kind: "enabled"; pubky: string };

interface SessionStatusState {
  status: SessionUiStatus;
  setFromRestore: (
    restore: { status: "live" | "needs-enable" | "session-offline"; pubky?: string },
    enable?: EnableStatus,
    opts?: { hasIdentity?: boolean },
  ) => void;
  setEnabled: (pubky: string) => void;
  setNeedsEnable: () => void;
  reset: () => void;
}

function pubkyOf(status: SessionUiStatus): string {
  if (
    status.kind === "session-offline" ||
    status.kind === "live" ||
    status.kind === "enabled"
  ) {
    return status.pubky;
  }
  return "";
}

export function readInitialSessionUiStatus(): SessionUiStatus {
  const pubky = getEnableCompletedPubky();
  if (pubky) return { kind: "enabled", pubky };
  return { kind: "unknown" };
}

function createSessionStatusStore(): UseBoundStore<StoreApi<SessionStatusState>> {
  const api = createStore<SessionStatusState>((set) => ({
    status: readInitialSessionUiStatus(),
    setFromRestore: (restore, enable, opts) => {
      set((state) => {
        if (restore.status === "session-offline") {
          return {
            status: {
              kind: "session-offline",
              pubky: restore.pubky || pubkyOf(state.status),
            },
          };
        }
        const completedPubky = getEnableCompletedPubky();
        if (completedPubky || state.status.kind === "enabled") {
          return {
            status: {
              kind: "enabled",
              pubky: completedPubky || pubkyOf(state.status),
            },
          };
        }
        if (restore.status !== "live" || !restore.pubky) {
          if (state.status.kind === "needs-enable" || state.status.kind === "live") {
            return state;
          }
          return {
            status: { kind: opts?.hasIdentity ? "needs-enable" : "no-identity" },
          };
        }
        if (enable === "enabled" || isEnableCompleted()) {
          return { status: { kind: "enabled", pubky: restore.pubky } };
        }
        return { status: { kind: "live", pubky: restore.pubky } };
      });
    },
    setEnabled: (pubky) => {
      markEnableCompleted(pubky);
      set({ status: { kind: "enabled", pubky } });
    },
    setNeedsEnable: () => set({ status: { kind: "needs-enable" } }),
    reset: () => {
      clearEnableCompleted();
      set({ status: { kind: "no-identity" } });
    },
  }));
  // useSyncExternalStore hydrates from getInitialState, not getState. A remount
  // after setEnabled must not paint the creation-time "unknown" snapshot.
  api.getInitialState = () => api.getState();
  const useBoundStore = ((selector: (state: SessionStatusState) => unknown) =>
    useStore(api, selector)) as UseBoundStore<StoreApi<SessionStatusState>>;
  return Object.assign(useBoundStore, api);
}

const sessionStatusStoreKey = "__hypercolorSessionStatusStore";
type SessionStatusGlobal = typeof globalThis & {
  [sessionStatusStoreKey]?: ReturnType<typeof createSessionStatusStore>;
};

/** Survive Next Fast Refresh so Enable's setEnabled is not lost on a new store instance. */
export const useSessionStatusStore =
  (globalThis as SessionStatusGlobal)[sessionStatusStoreKey] ??
  ((globalThis as SessionStatusGlobal)[sessionStatusStoreKey] =
    createSessionStatusStore());
