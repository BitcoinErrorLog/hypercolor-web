/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PaymentNotice } from "@/components/payment-notice";
import { paymentDisplayStatusText, ThreadView } from "@/components/thread-view";
import {
  peekThreadOrigin,
  rememberThreadOrigin,
  takeThreadOrigin,
} from "@/lib/list-detail-focus";
import type { LinkMessage } from "@/types/link";
import {
  buildPaymentAcceptanceEnvelope,
  buildPaymentCancellationEnvelope,
  buildPaymentProofEnvelope,
  buildPaymentRejectionEnvelope,
  buildPaymentRequestEnvelope,
  buildPrivatePaymentListEnvelope,
} from "@/types/payment";

vi.mock("next/navigation", () => ({
  usePathname: () => "/chats",
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    back: () => undefined,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PAYMENT_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);

let host: HTMLDivElement;
let root: Root;

function stubMatchMedia(matches = false) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

async function renderThread(props?: Partial<Parameters<typeof ThreadView>[0]>) {
  await act(async () => {
    root.render(
      <ThreadView
        conversationId={`dm:${OWNER}`}
        participantPubky={OWNER}
        displayName="Ada"
        localPubky={null}
        messages={[]}
        attachments={[]}
        loading={false}
        error={null}
        draft=""
        sending={false}
        status={{ kind: "no-identity" }}
        enableCta={null}
        renderAttachment={() => null}
        onChangeDraft={() => undefined}
        onSend={() => undefined}
        onAttach={() => undefined}
        onRetry={() => undefined}
        onResolved={() => undefined}
        {...props}
      />,
    );
  });
}

async function render(ui: ReactNode) {
  await act(async () => {
    root.render(ui);
  });
}

function paymentMessage(input: {
  kind: string;
  rawJson: string;
  body?: string;
}): LinkMessage {
  return {
    ownerPubky: OWNER,
    eventId: "55555555-5555-4555-8555-555555555555",
    conversationId: `dm:${PEER}`,
    peerPubky: PEER,
    senderPubky: PEER,
    direction: "received",
    kind: input.kind,
    rawJson: input.rawJson,
    body: input.body ?? "Payment",
    sentAt: NOW,
    receivedAt: NOW,
    deliveryState: "delivered",
  };
}

function paymentRequestMessage(expiresAtMs: number | null) {
  const { envelope, json } = buildPaymentRequestEnvelope({
    eventId: "55555555-5555-4555-8555-555555555555",
    paymentRequestId: PAYMENT_REQUEST_ID,
    amountValue: "0.001",
    paymentReference: "coffee",
    endpointIds: ["btc-lightning-bolt11"],
    expiresAtMs,
  });
  return paymentMessage({ kind: envelope.kind, rawJson: json, body: "Payment request" });
}

function paymentAcceptanceMessage() {
  const { envelope, json } = buildPaymentAcceptanceEnvelope({
    eventId: "66666666-6666-4666-8666-666666666666",
    paymentRequestId: PAYMENT_REQUEST_ID,
  });
  return paymentMessage({ kind: envelope.kind, rawJson: json, body: "Payment accepted" });
}

function paymentProofMessage() {
  const { envelope, json } = buildPaymentProofEnvelope({
    eventId: "77777777-7777-4777-8777-777777777777",
    paymentRequestId: PAYMENT_REQUEST_ID,
    paymentReference: "coffee",
    paymentEndpointIdentifier: "btc-lightning-bolt11",
    proofData: "fixture-preimage",
  });
  return paymentMessage({ kind: envelope.kind, rawJson: json, body: "Payment proof" });
}

function paymentRejectionMessage() {
  const { envelope, json } = buildPaymentRejectionEnvelope({
    eventId: "88888888-8888-4888-8888-888888888888",
    paymentRequestId: PAYMENT_REQUEST_ID,
  });
  return paymentMessage({ kind: envelope.kind, rawJson: json, body: "Payment rejected" });
}

function paymentCancellationMessage() {
  const { envelope, json } = buildPaymentCancellationEnvelope({
    eventId: "99999999-9999-4999-8999-999999999999",
    paymentRequestId: PAYMENT_REQUEST_ID,
  });
  return paymentMessage({ kind: envelope.kind, rawJson: json, body: "Payment cancelled" });
}

function privatePaymentListMessage() {
  const { envelope, json } = buildPrivatePaymentListEnvelope({ paymentEndpoints: {} });
  return paymentMessage({ kind: envelope.kind, rawJson: json, body: "Tip list" });
}

describe("ThreadView origin snapshot", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    stubMatchMedia(false);
    sessionStorage.clear();
    takeThreadOrigin();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    sessionStorage.clear();
    takeThreadOrigin();
  });

  it("renders with a stored chats origin and labels Back to Chats", async () => {
    sessionStorage.setItem("hypercolor.thread-origin", JSON.stringify({ kind: "chats" }));
    expect(peekThreadOrigin()).toBe(peekThreadOrigin());
    await renderThread();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.querySelector("[data-testid=threadScreen]")).not.toBeNull();
    expect(host.querySelector("[data-testid=detailBack]")?.getAttribute("aria-label")).toBe(
      "Back to Chats",
    );
  });

  it("renders with a stored contact origin and labels Back to Contact", async () => {
    rememberThreadOrigin({ kind: "contact", pubky: OWNER });
    await renderThread();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.querySelector("[data-testid=threadScreen]")).not.toBeNull();
    expect(host.querySelector("[data-testid=detailBack]")?.getAttribute("aria-label")).toBe(
      "Back to Contact",
    );
  });
});

describe("ThreadView payment status text", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    stubMatchMedia(false);
    sessionStorage.clear();
    takeThreadOrigin();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    sessionStorage.clear();
    takeThreadOrigin();
  });

  it.each([
    ["pending", paymentRequestMessage(NOW + 60_000), "Requested by peer"],
    ["expired", paymentRequestMessage(NOW - 60_000), "Expired before acceptance"],
    ["accepted", paymentAcceptanceMessage(), "Accepted"],
    ["proof_received", paymentProofMessage(), "Payment proof could not be verified yet"],
    ["rejected", paymentRejectionMessage(), "Failed before wallet handoff"],
    ["cancelled", paymentCancellationMessage(), "Failed before wallet handoff"],
    ["private_payment_list", privatePaymentListMessage(), "Unverified payment methods"],
  ])("renders %s payment status as visible text", async (_status, message, expected) => {
    await renderThread({
      participantPubky: PEER,
      localPubky: OWNER,
      messages: [message],
      status: { kind: "enabled", pubky: OWNER },
      now: NOW,
    });

    expect(host.textContent).toContain(expected);
    expect(host.textContent).not.toContain("Paid on mobile wallet");
  });

  it("renders verified payment status as Paid", async () => {
    await render(
      <PaymentNotice
        notice={{ title: "Payment proof", amount: null, reference: null }}
        mine={false}
        status={paymentDisplayStatusText("verified")}
      />,
    );

    expect(host.textContent).toContain("Paid");
  });

  it("renders own pending payment request as Requested", async () => {
    const message = { ...paymentRequestMessage(NOW + 60_000), senderPubky: OWNER, direction: "sent" as const };
    await renderThread({
      participantPubky: PEER,
      localPubky: OWNER,
      messages: [message],
      status: { kind: "enabled", pubky: OWNER },
      now: NOW,
    });

    expect(host.textContent).toContain("Requested");
    expect(host.textContent).not.toContain("Requested by peer");
  });

  it.each([
    ["accepted", "Accepted"],
    ["claimed", "Payment proof could not be verified yet"],
    ["verified", "Paid"],
    ["expired", "Expired before acceptance"],
    ["rejected", "Failed before wallet handoff"],
    ["cancelled", "Failed before wallet handoff"],
    ["pending", "Requested by peer"],
    ["proof_received", "Payment proof could not be verified yet"],
    ["sending", "Sending"],
  ] as const)("maps %s display status to receipt copy", (status, expected) => {
    expect(paymentDisplayStatusText(status)).toBe(expected);
  });
});

describe("ThreadView standby composer", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    stubMatchMedia(false);
    sessionStorage.clear();
    takeThreadOrigin();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    sessionStorage.clear();
    takeThreadOrigin();
  });

  it("blocks send and shows receive CTA when standby with no established link", async () => {
    const onSend = vi.fn();
    const onTakeoverReceive = vi.fn(async () => undefined);
    await renderThread({
      participantPubky: PEER,
      localPubky: OWNER,
      draft: "hello",
      status: { kind: "enabled", pubky: OWNER },
      receiverRole: "standby",
      linkStatus: null,
      onSend,
      onTakeoverReceive,
    });
    expect(host.querySelector("[data-testid=standbyComposerNotice]")?.textContent).toContain(
      "This device isn't receiving new chats. Receive on this device to start this conversation.",
    );
    expect(host.querySelector("[data-testid=threadStandbyTakeover]")?.textContent).toContain(
      "Receive on this device",
    );
    const send = host.querySelector("[data-testid=threadSend]");
    expect(send).toHaveProperty("disabled", true);
    await act(async () => {
      host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("allows send on standby when the link is established", async () => {
    const onSend = vi.fn();
    await renderThread({
      participantPubky: PEER,
      localPubky: OWNER,
      draft: "hello",
      status: { kind: "enabled", pubky: OWNER },
      receiverRole: "standby",
      linkStatus: "established",
      linkSnapshot: "HC1.opaque",
      linkReady: true,
      onSend,
    });
    expect(host.querySelector("[data-testid=standbyComposerNotice]")).toBeNull();
    expect(host.querySelector("[data-testid=threadSend]")).toHaveProperty("disabled", false);
  });

  it("keeps the draft and sends after takeover", async () => {
    const onSend = vi.fn();
    const onTakeoverReceive = vi.fn(async () => {
      onSend();
    });
    await renderThread({
      participantPubky: PEER,
      localPubky: OWNER,
      draft: "keep me",
      status: { kind: "enabled", pubky: OWNER },
      receiverRole: "standby",
      linkStatus: "handshaking",
      onSend,
      onTakeoverReceive,
    });
    expect(host.querySelector("[data-testid=threadDraft]")).toHaveProperty("value", "keep me");
    await act(async () => {
      document.querySelector("[data-testid=threadStandbyTakeover]")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await act(async () => {
      document.querySelector("[data-testid=standbyTakeoverConfirm]")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(onTakeoverReceive).toHaveBeenCalled();
    });
  });

  it("uses standby queued subtitle copy", async () => {
    await renderThread({
      participantPubky: PEER,
      localPubky: OWNER,
      status: { kind: "enabled", pubky: OWNER },
      receiverRole: "standby",
      linkStatus: "handshaking",
      messages: [
        {
          ownerPubky: OWNER,
          eventId: "11111111-1111-4111-8111-111111111111",
          conversationId: `dm:${PEER}`,
          peerPubky: PEER,
          senderPubky: OWNER,
          direction: "sent",
          kind: "chat.message.v0",
          rawJson: "{}",
          body: "queued",
          sentAt: NOW,
          receivedAt: null,
          deliveryState: "sending",
        },
      ],
    });
    expect(host.querySelector("[data-testid=queuedHandshakeSubtitle]")?.textContent).toBe(
      "Not receiving on this device — tap Receive on this device to continue.",
    );
  });

  it("uses standby queued subtitle for a responder handshake", async () => {
    await renderThread({
      participantPubky: PEER,
      localPubky: OWNER,
      status: { kind: "enabled", pubky: OWNER },
      receiverRole: "standby",
      linkStatus: "handshaking-responder",
      messages: [
        {
          ownerPubky: OWNER,
          eventId: "11111111-1111-4111-8111-111111111111",
          conversationId: `dm:${PEER}`,
          peerPubky: PEER,
          senderPubky: OWNER,
          direction: "sent",
          kind: "chat.message.v0",
          rawJson: "{}",
          body: "queued",
          sentAt: NOW,
          receivedAt: null,
          deliveryState: "sending",
        },
      ],
    });
    expect(host.querySelector("[data-testid=queuedHandshakeSubtitle]")?.textContent).toBe(
      "Not receiving on this device — tap Receive on this device to continue.",
    );
  });

  it("blocks a zombie established row without a snapshot", async () => {
    const onSend = vi.fn();
    await renderThread({
      participantPubky: PEER,
      localPubky: OWNER,
      draft: "hello",
      status: { kind: "enabled", pubky: OWNER },
      receiverRole: "standby",
      linkStatus: "established",
      linkSnapshot: "",
      onSend,
    });
    expect(host.querySelector("[data-testid=standbyComposerNotice]")).not.toBeNull();
    expect(host.querySelector("[data-testid=threadSend]")).toHaveProperty("disabled", true);
  });

  it("renders snapshot messages without a read-only error box", async () => {
    await renderThread({
      participantPubky: PEER,
      localPubky: OWNER,
      status: { kind: "enabled", pubky: OWNER },
      error: "This tab cannot write. Reads still work. Take over writing here to send or save.",
      messages: [
        {
          ownerPubky: OWNER,
          eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          conversationId: `dm:${PEER}`,
          peerPubky: PEER,
          senderPubky: PEER,
          direction: "received",
          kind: "chat.message.v0",
          rawJson: "{}",
          body: "from phone",
          sentAt: NOW,
          receivedAt: NOW,
          deliveryState: "delivered",
        },
      ],
    });
    expect(host.textContent).toContain("from phone");
    expect(host.textContent).not.toContain("Could not load this thread.");
  });

  it("renders connection-changed retry copy when the link is blocked", async () => {
    const onRetry = vi.fn();
    await renderThread({
      status: { kind: "enabled", pubky: OWNER },
      localPubky: OWNER,
      linkStatus: "error",
      onRetry,
      messages: [
        {
          ownerPubky: OWNER,
          eventId: "evt-queued",
          conversationId: `dm:${OWNER}`,
          peerPubky: OWNER,
          senderPubky: OWNER,
          direction: "sent",
          kind: "chat.message.v0",
          rawJson: "{}",
          body: "held",
          sentAt: NOW,
          receivedAt: null,
          deliveryState: "sending",
        },
      ],
    });
    expect(host.textContent).toContain("Connection changed — tap to retry");
    expect(host.textContent).toContain("Queued");
    (host.querySelector("[data-testid=threadLinkRetry]") as HTMLButtonElement).click();
    expect(onRetry).toHaveBeenCalled();
  });
});
