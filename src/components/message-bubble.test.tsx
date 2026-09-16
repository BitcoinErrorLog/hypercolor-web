/** @vitest-environment jsdom */

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DmMessageBubble } from "./message-bubble";
import { CHAT_MESSAGE_KIND, type LinkMessage } from "@/types/link";
import { PAYKIT_PAYMENT_REQUEST_KIND } from "@/types/payment";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

let host: HTMLDivElement;
let root: Root;

function message(overrides: Partial<LinkMessage> = {}): LinkMessage {
  return {
    ownerPubky: OWNER,
    eventId: "00000000-0000-4000-8000-000000000001",
    conversationId: `dm:${PEER}`,
    peerPubky: PEER,
    senderPubky: OWNER,
    direction: "sent",
    kind: CHAT_MESSAGE_KIND,
    rawJson: "{}",
    body: "hello",
    sentAt: 1_700_000_000_000,
    receivedAt: null,
    deliveryState: "sent",
    ...overrides,
  };
}

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

describe("DmMessageBubble unsend action", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.querySelector("[data-testid=unsendDialog]")?.remove();
  });

  it("gates unsend to own non-payment messages and confirms through the dialog", async () => {
    const onUnsend = vi.fn(async () => undefined);
    await render(
      <DmMessageBubble message={message()} mine onUnsend={onUnsend} />,
    );
    expect(host.textContent).toContain("Unsend");

    await act(async () => {
      (host.querySelector("button:last-of-type") as HTMLButtonElement).click();
    });
    expect(document.querySelector("[data-testid=unsendDialog]")?.textContent).toContain(
      "Unsend message",
    );
    await act(async () => {
      (document.querySelector("[data-testid=unsendConfirm]") as HTMLButtonElement).click();
    });
    expect(onUnsend).toHaveBeenCalledOnce();
  });

  it("hides unsend for non-own and payment messages", async () => {
    const onUnsend = vi.fn(async () => undefined);
    await render(
      <DmMessageBubble
        message={message({ senderPubky: PEER, direction: "received" })}
        mine={false}
        onUnsend={onUnsend}
      />,
    );
    expect(host.textContent).not.toContain("Unsend");

    await render(
      <DmMessageBubble
        message={message({ kind: PAYKIT_PAYMENT_REQUEST_KIND })}
        mine
        onUnsend={onUnsend}
      />,
    );
    expect(host.textContent).not.toContain("Unsend");
  });

  it("renders a tombstone without a delivery status", async () => {
    await render(
      <DmMessageBubble
        message={message({ deleted: true, deliveryState: "unsent", body: "" })}
        mine
        onUnsend={vi.fn(async () => undefined)}
      />,
    );

    expect(host.textContent).toContain("Message unsent");
    expect(host.textContent).not.toContain("Sent");
    expect(host.querySelector('[data-testid="unsendDialog"]')).toBeNull();
  });
});
