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
  switch (status.kind) {
    case "session-offline":
    case "live":
    case "enabled":
      return status.pubky;
    default:
      return "";
  }
}

export const useSessionStatusStore = create<SessionStatusState>((set) => ({
  status: { kind: "unknown" },
  setFromRestore: (restore, enable, opts) => {
    set((state) => {
      // `setFromRestore` applies a snapshot read when the document loaded.
      // The store starts at "unknown" per document, so an "enabled" already in
      // the store can only have come from the Enable flow completing while the
      // snapshot was being read — a later fact than the snapshot. Do not
      // downgrade it. A genuine loss of access arrives via reset/setNeedsEnable
      // or the next page load's own fresh snapshot.
      if (state.status.kind === "enabled") return state;
      if (restore.status === "session-offline") {
        return {
          status: {
            kind: "session-offline" as const,
            pubky: restore.pubky || pubkyOf(state.status),
          },
        };
      }
      if (restore.status !== "live" || !restore.pubky) {
        return {
          status: { kind: opts?.hasIdentity ? ("needs-enable" as const) : ("no-identity" as const) },
        };
      }
      if (enable === "enabled") {
        return { status: { kind: "enabled" as const, pubky: restore.pubky } };
      }
      return { status: { kind: "live" as const, pubky: restore.pubky } };
    });
  },
  setEnabled: (pubky) => set({ status: { kind: "enabled", pubky } }),
  setNeedsEnable: () => set({ status: { kind: "needs-enable" } }),
  reset: () => set({ status: { kind: "no-identity" } }),
}));
