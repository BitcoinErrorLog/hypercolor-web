import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  rememberThreadOrigin,
  peekThreadOrigin,
  takeThreadOrigin,
  threadBackHref,
  threadBackLabel,
  resolveFocusTarget,
  detailHeadingTag,
  subscribeThreadOrigin,
  rememberListRow,
  takeListRow,
  clearListDetailFocus,
} from "./list-detail-focus";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

const memory = new Map<string, string>();
const fakeStorage = {
  getItem(key: string) {
    return memory.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    memory.set(key, value);
  },
  removeItem(key: string) {
    memory.delete(key);
  },
};

describe("list-detail-focus", () => {
  beforeEach(() => {
    memory.clear();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: fakeStorage,
    });
  });

  afterEach(() => {
    takeThreadOrigin();
    memory.clear();
  });

  it("returns a contact thread to that contact and chats/direct links to /chats", () => {
    rememberThreadOrigin({ kind: "contact", pubky: OWNER });
    expect(peekThreadOrigin()).toEqual({ kind: "contact", pubky: OWNER });
    expect(threadBackHref(peekThreadOrigin())).toBe(`/contacts/${encodeURIComponent(OWNER)}`);
    expect(threadBackLabel(peekThreadOrigin())).toBe("Contact");
    expect(takeThreadOrigin()).toEqual({ kind: "contact", pubky: OWNER });
    expect(peekThreadOrigin()).toBeNull();

    rememberThreadOrigin({ kind: "chats" });
    expect(threadBackHref(peekThreadOrigin())).toBe("/chats");
    expect(threadBackLabel(peekThreadOrigin())).toBe("Chats");
    expect(threadBackHref(null)).toBe("/chats");
    expect(threadBackLabel(null)).toBe("Chats");
  });

  it("does not call peekThreadOrigin during a prerender-safe first snapshot", () => {
    expect(peekThreadOrigin()).toBeNull();
  });

  it("rejects an invalid contact origin instead of storing it", () => {
    rememberThreadOrigin({ kind: "contact", pubky: "not-a-pubky" });
    expect(peekThreadOrigin()).toBeNull();
  });

  it("falls back to the list heading when the remembered row is gone", () => {
    const heading = { id: "heading" } as HTMLElement;
    expect(resolveFocusTarget("missing-row", heading, () => null)).toBe(heading);
    const row = { id: "row" } as HTMLElement;
    expect(resolveFocusTarget("row", heading, (id) => (id === "row" ? row : null))).toBe(row);
    expect(resolveFocusTarget(null, heading)).toBe(heading);
  });

  it("uses h1 when the list pane is hidden and h2 in the desktop two-pane", () => {
    expect(detailHeadingTag(false)).toBe("h1");
    expect(detailHeadingTag(true)).toBe("h2");
  });

  it("returns a stable snapshot object until the stored origin changes", () => {
    memory.set("hypercolor.thread-origin", JSON.stringify({ kind: "chats" }));
    const first = peekThreadOrigin();
    const second = peekThreadOrigin();
    expect(first).toEqual({ kind: "chats" });
    expect(first).toBe(second);

    rememberThreadOrigin({ kind: "contact", pubky: OWNER });
    const contact = peekThreadOrigin();
    expect(contact).toEqual({ kind: "contact", pubky: OWNER });
    expect(peekThreadOrigin()).toBe(contact);
    expect(contact).not.toBe(first);
  });

  it("notifies subscribers on same-document origin writes", () => {
    let calls = 0;
    const stop = subscribeThreadOrigin(() => {
      calls += 1;
    });
    rememberThreadOrigin({ kind: "chats" });
    expect(calls).toBe(1);
    takeThreadOrigin();
    expect(calls).toBe(2);
    stop();
    rememberThreadOrigin({ kind: "chats" });
    expect(calls).toBe(2);
  });

  it("clearListDetailFocus drops both origin keys and notifies subscribers", () => {
    rememberThreadOrigin({ kind: "contact", pubky: OWNER });
    rememberListRow("chats", "chat-row-1");
    let calls = 0;
    const stop = subscribeThreadOrigin(() => {
      calls += 1;
    });
    clearListDetailFocus();
    expect(peekThreadOrigin()).toBeNull();
    expect(takeListRow("chats")).toBeNull();
    expect(memory.has("hypercolor.thread-origin")).toBe(false);
    expect(memory.has("hypercolor.list-detail-origin")).toBe(false);
    expect(calls).toBe(1);
    stop();
  });
});
