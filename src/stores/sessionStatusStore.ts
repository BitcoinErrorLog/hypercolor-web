import { create } from "zustand";
import type { EnableStatus } from "@/services/link/session";

export type SessionUiStatus =
  | { kind: "unknown" }
  | { kind: "needs-enable" }
  | { kind: "session-offline"; pubky: string }
  | { kind: "live"; pubky: string }
  | { kind: "enabled"; pubky: string };

interface SessionStatusState {
  status: SessionUiStatus;
  setFromRestore: (
    restore: { status: "live" | "needs-enable" | "session-offline"; pubky?: string },
    enable?: EnableStatus,
  ) => void;
  setEnabled: (pubky: string) => void;
  reset: () => void;
}

export const useSessionStatusStore = create<SessionStatusState>((set) => ({
  status: { kind: "unknown" },
  setFromRestore: (restore, enable) => {
    if (restore.status === "session-offline") {
      set({
        status: { kind: "session-offline", pubky: restore.pubky ?? "" },
      });
      return;
    }
    if (restore.status !== "live" || !restore.pubky) {
      set({ status: { kind: "needs-enable" } });
      return;
    }
    if (enable === "enabled") {
      set({ status: { kind: "enabled", pubky: restore.pubky } });
      return;
    }
    set({ status: { kind: "live", pubky: restore.pubky } });
  },
  setEnabled: (pubky) => set({ status: { kind: "enabled", pubky } }),
  reset: () => set({ status: { kind: "needs-enable" } }),
}));
