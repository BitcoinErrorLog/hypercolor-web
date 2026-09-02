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

let cachedThreadOriginRaw: string | null | undefined;
let cachedThreadOrigin: ThreadOrigin | null = null;
const threadOriginListeners = new Set<() => void>();

function readThreadOriginRaw(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return sessionStorage.getItem(THREAD_ORIGIN_KEY);
  } catch {
    return null;
  }
}

function parseThreadOriginRaw(raw: string | null): ThreadOrigin | null {
  if (!raw) return null;
  try {
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

function commitThreadOrigin(raw: string | null, origin: ThreadOrigin | null): void {
  cachedThreadOriginRaw = raw;
  cachedThreadOrigin = origin;
  for (const listener of threadOriginListeners) listener();
}

export function rememberThreadOrigin(origin: ThreadOrigin): void {
  if (typeof sessionStorage === "undefined") return;
  let stored: ThreadOrigin;
  if (origin.kind === "contact") {
    const pubky = parsePubky(origin.pubky);
    if (!pubky) return;
    stored = { kind: "contact", pubky };
  } else {
    stored = { kind: "chats" };
  }
  const raw = JSON.stringify(stored);
  sessionStorage.setItem(THREAD_ORIGIN_KEY, raw);
  commitThreadOrigin(raw, stored);
}

export function peekThreadOrigin(): ThreadOrigin | null {
  const raw = readThreadOriginRaw();
  if (raw === cachedThreadOriginRaw) return cachedThreadOrigin;
  const origin = parseThreadOriginRaw(raw);
  cachedThreadOriginRaw = raw;
  cachedThreadOrigin = origin;
  return cachedThreadOrigin;
}

export function getServerThreadOrigin(): ThreadOrigin | null {
  return null;
}

export function subscribeThreadOrigin(onChange: () => void): () => void {
  threadOriginListeners.add(onChange);
  if (typeof window === "undefined") {
    return () => {
      threadOriginListeners.delete(onChange);
    };
  }
  window.addEventListener("storage", onChange);
  return () => {
    threadOriginListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function takeThreadOrigin(): ThreadOrigin | null {
  const origin = peekThreadOrigin();
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(THREAD_ORIGIN_KEY);
  }
  commitThreadOrigin(null, null);
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
