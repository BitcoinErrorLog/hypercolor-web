/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactElement, useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useThread } from "@/hooks/useThread";
import { useAuthStore } from "@/stores/authStore";
import { useInboxStore } from "@/stores/inboxStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { useThreadStore } from "@/stores/threadStore";
import { buildDmConversationId, CHAT_MESSAGE_KIND, type LinkMessage } from "@/types/link";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const CONVERSATION_ID = buildDmConversationId(PEER);

const getLinkMessagesForConversation = vi.fn<(owner: string, conversationId: string, limit: number) => Promise<LinkMessage[]>>(
  async () => [],
);
const listAttachmentsForConversation = vi.fn<(owner: string, conversationId: string) => Promise<unknown[]>>(
  async () => [],
);
const listLinkConversations = vi.fn<(owner: string) => Promise<unknown[]>>(async () => []);
const countPendingMessageRequests = vi.fn<(owner: string) => Promise<number>>(async () => 0);
const syncInbox = vi.fn<(peers?: string[]) => Promise<unknown[]>>(async () => []);
const sendDm = vi.fn<(peer: string, text: string) => Promise<{ deliveryState: "sent" }>>(async () => ({
  deliveryState: "sent",
}));
const markRead = vi.fn<(conversationId: string, readAt?: number) => Promise<void>>(async () => undefined);
const subscribeInboxSynced = vi.fn((listener: (owner: string) => void) => {
  return () => {
    void listener;
  };
});

vi.mock("@/services/link/LinkService", () => ({
  LinkService: {
    hasSession: () => true,
    syncInbox: (peers?: string[]) => syncInbox(peers),
    sendDm: (peer: string, text: string) => sendDm(peer, text),
    markRead: (conversationId: string, readAt?: number) => markRead(conversationId, readAt),
    subscribeInboxSynced: (listener: (owner: string) => void) => subscribeInboxSynced(listener),
    retryPendingSends: () => Promise.resolve(),
    retryPeerSends: () => Promise.resolve(),
    getLinkStatus: async () => null,
  },
}));

vi.mock("@/services/StorageService", () => ({
  StorageService: {
    getLinkMessagesForConversation: (...args: [string, string, number]) =>
      getLinkMessagesForConversation(...args),
    listAttachmentsForConversation: (...args: [string, string]) =>
      listAttachmentsForConversation(...args),
    listLinkConversations: (...args: [string]) => listLinkConversations(...args),
    countPendingMessageRequests: (...args: [string]) => countPendingMessageRequests(...args),
    getLinkReceiver: vi.fn(async () => null),
    getLink: vi.fn(async () => null),
  },
}));

vi.mock("@/services/vibeware/collector", () => ({
  emit: vi.fn(() => undefined),
}));

function inbound(body: string): LinkMessage {
  return {
    ownerPubky: OWNER,
    eventId: `evt-${body}`,
    conversationId: CONVERSATION_ID,
    peerPubky: PEER,
    senderPubky: PEER,
    direction: "received",
    kind: CHAT_MESSAGE_KIND,
    rawJson: "{}",
    body,
    sentAt: 1,
    receivedAt: 1,
    deliveryState: "delivered",
  };
}

function Probe({ initialDraft = "" }: { initialDraft?: string }) {
  const thread = useThread(CONVERSATION_ID);
  // Seed the composer from the test case; setDraft is stable.
  useEffect(() => {
    if (initialDraft) thread.setDraft(initialDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed composer; including `thread` retriggers every render
  }, [initialDraft, thread.setDraft]);
  return (
    <div>
      <ul data-testid="messages">
        {thread.messages.map((message) => (
          <li key={message.eventId}>{message.body}</li>
        ))}
      </ul>
      <button type="button" data-testid="send" onClick={() => void thread.send()}>
        send
      </button>
      <output data-testid="error">{thread.error ?? ""}</output>
    </div>
  );
}

let host: HTMLDivElement;
let root: Root;

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

describe("useThread inbox poll", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    getLinkMessagesForConversation.mockReset().mockResolvedValue([]);
    listAttachmentsForConversation.mockReset().mockResolvedValue([]);
    listLinkConversations.mockReset().mockResolvedValue([]);
    countPendingMessageRequests.mockReset().mockResolvedValue(0);
    syncInbox.mockReset().mockResolvedValue([]);
    sendDm.mockReset().mockResolvedValue({ deliveryState: "sent" });
    markRead.mockReset().mockResolvedValue(undefined);
    subscribeInboxSynced.mockClear();
    useThreadStore.getState().reset();
    useInboxStore.getState().reset();
    useAuthStore.getState().setAuthenticated(OWNER, "https://homeserver.example");
    useSessionStatusStore.getState().setEnabled(OWNER);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    useThreadStore.getState().reset();
    useInboxStore.getState().reset();
    useAuthStore.getState().clearSession();
    useSessionStatusStore.getState().reset();
    vi.useRealTimers();
  });

  it("renders a new inbound row from the thread store without a page reload", async () => {
    await render(<Probe />);
    expect(host.querySelector("[data-testid=messages]")?.textContent).toBe("");

    await act(async () => {
      useThreadStore.getState().setSnapshot(CONVERSATION_ID, [inbound("from mobile")], []);
    });

    expect(host.querySelector("[data-testid=messages]")?.textContent).toContain("from mobile");
  });

  it("syncs the open link immediately after send", async () => {
    await render(<Probe initialDraft="hello" />);
    await vi.waitFor(() => {
      expect(syncInbox).toHaveBeenCalled();
    });
    const syncsBeforeSend = syncInbox.mock.calls.length;
    await act(async () => {
      host.querySelector("[data-testid=send]")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(sendDm).toHaveBeenCalledWith(PEER, "hello");
    });
    expect(syncInbox.mock.calls.length).toBeGreaterThan(syncsBeforeSend);
    expect(syncInbox).toHaveBeenCalledWith([PEER]);
  });

  it("keeps thrown URLs out of rendered send errors", async () => {
    sendDm.mockRejectedValueOnce(new Error("https://attacker.example/private"));
    await render(<Probe initialDraft="hello" />);
    await act(async () => {
      host.querySelector("[data-testid=send]")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=error]")?.textContent).toBe(
        "Could not send this message.",
      );
    });
    expect(host.textContent).not.toContain("attacker.example");
  });
});
