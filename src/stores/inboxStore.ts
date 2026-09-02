import { create } from "zustand";
import { dmInboxRows, type InboxRow } from "@/lib/inbox";
import { StorageService } from "@/services/StorageService";

interface InboxState {
  rows: InboxRow[];
  pendingRequests: number;
  loading: boolean;
  error: string | null;
  setRows: (rows: InboxRow[], pendingRequests: number) => void;
  setPendingRequests: (pendingRequests: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  rows: [],
  pendingRequests: 0,
  loading: false,
  error: null,
  setRows: (rows, pendingRequests) => set({ rows, pendingRequests, error: null }),
  setPendingRequests: (pendingRequests) => set({ pendingRequests }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () => set({ rows: [], pendingRequests: 0, loading: false, error: null }),
}));

/** Chats lists one-to-one DMs only. Private groups load through the Channels store. */
export async function loadInboxRows(ownerPubky: string): Promise<{
  rows: InboxRow[];
  pendingRequests: number;
}> {
  const [dms, pendingRequests] = await Promise.all([
    StorageService.listLinkConversations(ownerPubky),
    StorageService.countPendingMessageRequests(ownerPubky),
  ]);
  return {
    rows: dmInboxRows(dms),
    pendingRequests,
  };
}
