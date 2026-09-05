import type { ReceiverRole } from "@/types/link";
import { create } from "zustand";

interface ReceiverRoleState {
  role: ReceiverRole | null;
  toast: string | null;
  setRole: (role: ReceiverRole | null, toast?: string | null) => void;
  clearToast: () => void;
  reset: () => void;
}

export const useReceiverRoleStore = create<ReceiverRoleState>((set) => ({
  role: null,
  toast: null,
  setRole: (role, toast = null) => set({ role, toast: toast ?? null }),
  clearToast: () => set({ toast: null }),
  reset: () => set({ role: null, toast: null }),
}));

export function setReceiverRoleState(role: ReceiverRole | null, toast: string | null = null): void {
  useReceiverRoleStore.getState().setRole(role, toast);
}
