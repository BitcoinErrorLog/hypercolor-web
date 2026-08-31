import { create } from "zustand";
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

function createSessionStatusStore() {
  return create<SessionStatusState>((set) => ({
    status: { kind: "unknown" },
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
        // A slow first-load restore must not undo Enable or Welcome progress.
        if (state.status.kind === "enabled") {
          return state;
        }
        if (restore.status !== "live" || !restore.pubky) {
          if (state.status.kind === "needs-enable" || state.status.kind === "live") {
            return state;
          }
          return {
            status: { kind: opts?.hasIdentity ? "needs-enable" : "no-identity" },
          };
        }
        if (enable === "enabled") {
          return { status: { kind: "enabled", pubky: restore.pubky } };
        }
        return { status: { kind: "live", pubky: restore.pubky } };
      });
    },
    setEnabled: (pubky) => {
      if (typeof document !== "undefined") {
        document.documentElement.dataset.hcEnable = "enabled";
      }
      set({ status: { kind: "enabled", pubky } });
    },
    setNeedsEnable: () => set({ status: { kind: "needs-enable" } }),
    reset: () => set({ status: { kind: "no-identity" } }),
  }));
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
