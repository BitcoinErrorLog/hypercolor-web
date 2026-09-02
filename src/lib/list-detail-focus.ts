const STORAGE_KEY = "hypercolor.list-detail-origin";

export type ListPane = "chats" | "channels" | "contacts";

export type ListDetailOrigin = {
  list: ListPane;
  rowId: string;
};

function readOrigin(): ListDetailOrigin | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ListDetailOrigin>;
    if (
      (parsed.list === "chats" ||
        parsed.list === "channels" ||
        parsed.list === "contacts") &&
      typeof parsed.rowId === "string" &&
      parsed.rowId.length > 0
    ) {
      return { list: parsed.list, rowId: parsed.rowId };
    }
    return null;
  } catch {
    return null;
  }
}

export function rememberListRow(list: ListPane, rowId: string): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ list, rowId }));
}

export function takeListRow(list: ListPane): string | null {
  const origin = readOrigin();
  if (!origin || origin.list !== list) return null;
  sessionStorage.removeItem(STORAGE_KEY);
  return origin.rowId;
}

export function peekListRow(list: ListPane): string | null {
  const origin = readOrigin();
  if (!origin || origin.list !== list) return null;
  return origin.rowId;
}

export function chatRowDomId(conversationId: string): string {
  return `chat-row-${conversationId}`;
}

export function channelRowDomId(channelId: string): string {
  return `channel-row-${channelId}`;
}

export function topicRowDomId(tag: string): string {
  return `topic-row-${tag}`;
}

export function contactRowDomId(pubky: string): string {
  return `contact-row-${pubky}`;
}
