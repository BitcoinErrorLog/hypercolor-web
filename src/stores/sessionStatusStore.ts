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

export const useSessionStatusStore = create<SessionStatusState>((set) => ({
  status: { kind: "unknown" },
  setFromRestore: (restore, enable, opts) => {
    if (restore.status === "session-offline") {
      set({
        status: { kind: "session-offline", pubky: restore.pubky ?? "" },
      });
      return;
    }
    if (restore.status !== "live" || !restore.pubky) {
      set({
        status: { kind: opts?.hasIdentity ? "needs-enable" : "no-identity" },
      });
      return;
    }
    if (enable === "enabled") {
      set({ status: { kind: "enabled", pubky: restore.pubky } });
      return;
    }
    set({ status: { kind: "live", pubky: restore.pubky } });
  },
  setEnabled: (pubky) => set({ status: { kind: "enabled", pubky } }),
  setNeedsEnable: () => set({ status: { kind: "needs-enable" } }),
  reset: () => set({ status: { kind: "no-identity" } }),
}));
