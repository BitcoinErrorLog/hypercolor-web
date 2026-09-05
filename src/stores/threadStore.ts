import { create } from "zustand";
import type { AttachmentRecord } from "@/types/attachment";
import type { LinkMessage } from "@/types/link";

interface ThreadState {
  conversationId: string | null;
  messages: LinkMessage[];
  attachments: AttachmentRecord[];
  setSnapshot: (
    conversationId: string | null,
    messages: LinkMessage[],
    attachments: AttachmentRecord[],
  ) => void;
  reset: () => void;
}

export const useThreadStore = create<ThreadState>((set) => ({
  conversationId: null,
  messages: [],
  attachments: [],
  setSnapshot: (conversationId, messages, attachments) =>
    set({ conversationId, messages, attachments }),
  reset: () => set({ conversationId: null, messages: [], attachments: [] }),
}));
