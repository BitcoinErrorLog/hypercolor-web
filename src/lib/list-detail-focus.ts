import { scriptedScrollBehavior } from "@/lib/reduced-motion";
import { parsePubky } from "@/utils/pubkyId";

const STORAGE_KEY = "hypercolor.list-detail-origin";
const THREAD_ORIGIN_KEY = "hypercolor.thread-origin";

export type ListPane = "chats" | "channels" | "contacts";

export type ListDetailOrigin = {
  list: ListPane;
  rowId: string;
};

export type ThreadOrigin = { kind: "contact"; pubky: string } | { kind: "chats" };

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

export function resolveFocusTarget(
  rowId: string | null,
  heading: HTMLElement | null,
  lookup: (id: string) => HTMLElement | null = (id) =>
    typeof document === "undefined" ? null : document.getElementById(id),
): HTMLElement | null {
  if (rowId) {
    const row = lookup(rowId);
    if (row) return row;
  }
  return heading;
}

export function restoreListFocus(rowId: string | null, heading: HTMLElement | null): void {
  const target = resolveFocusTarget(rowId, heading);
  if (!target) return;
  if (typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ block: "nearest", behavior: scriptedScrollBehavior() });
  }
  target.focus();
}

/** Detail heading is h1 only when the list pane is not visible. */
export function detailHeadingTag(twoPane: boolean): "h1" | "h2" {
  return twoPane ? "h2" : "h1";
}

function readThreadOrigin(): ThreadOrigin | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(THREAD_ORIGIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ThreadOrigin> & { kind?: string; pubky?: string };
    if (parsed.kind === "chats") return { kind: "chats" };
    if (parsed.kind === "contact" && typeof parsed.pubky === "string") {
      const pubky = parsePubky(parsed.pubky);
      if (pubky) return { kind: "contact", pubky };
    }
    return null;
  } catch {
    return null;
  }
}

export function rememberThreadOrigin(origin: ThreadOrigin): void {
  if (typeof sessionStorage === "undefined") return;
  if (origin.kind === "contact") {
    const pubky = parsePubky(origin.pubky);
    if (!pubky) return;
    sessionStorage.setItem(THREAD_ORIGIN_KEY, JSON.stringify({ kind: "contact", pubky }));
    return;
  }
  sessionStorage.setItem(THREAD_ORIGIN_KEY, JSON.stringify({ kind: "chats" }));
}

export function peekThreadOrigin(): ThreadOrigin | null {
  return readThreadOrigin();
}

export function takeThreadOrigin(): ThreadOrigin | null {
  const origin = readThreadOrigin();
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(THREAD_ORIGIN_KEY);
  }
  return origin;
}

export function threadBackHref(origin: ThreadOrigin | null): string {
  if (origin?.kind === "contact") {
    return `/contacts/${encodeURIComponent(origin.pubky)}`;
  }
  return "/chats";
}

export function threadBackLabel(origin: ThreadOrigin | null): string {
  return origin?.kind === "contact" ? "Contact" : "Chats";
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
