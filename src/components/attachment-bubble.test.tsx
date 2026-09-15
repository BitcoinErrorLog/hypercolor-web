/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AttachmentBubble } from "@/components/attachment-bubble";
import { KeyStore } from "@/services/KeyStore";
import type { AttachmentRecord } from "@/types/attachment";

vi.mock("@/services/KeyStore", () => ({
  KeyStore: {
    getAttachmentSecret: vi.fn(),
  },
}));

vi.mock("@/services/attachments/AttachmentService", () => ({
  AttachmentService: {
    getAndDecrypt: vi.fn(),
  },
}));

vi.mock("@/services/vibeware/coarse", () => ({
  emitCoarseError: vi.fn(),
}));

const RECORD: AttachmentRecord = {
  ownerPubky: "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
  eventId: "11111111-1111-1111-1111-111111111111",
  conversationId: "dm:o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
  channelId: null,
  senderPubky: "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
  direction: "received",
  location: "/pub/hypercolor.app/v1/attachments/abc",
  keyRef: "__keystore__",
  contentType: "text/plain",
  size: 4,
  thumbnailLocation: null,
  localCachePath: null,
  createdAt: 0,
  updatedAt: 0,
  deliveryState: "delivered",
  resolveState: "ready",
};

let host: HTMLDivElement;
let root: Root;

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

describe("AttachmentBubble errors", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.mocked(KeyStore.getAttachmentSecret).mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("renders canonical decrypt copy with the raw message in Details", async () => {
    vi.mocked(KeyStore.getAttachmentSecret).mockRejectedValueOnce(
      new Error("XChaCha20Poly1305: ciphertext is unauthentic"),
    );
    await render(<AttachmentBubble record={RECORD} />);
    await act(async () => {
      host.querySelector("button")?.click();
    });
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.querySelector(":scope > p")?.textContent).toBe(
      "Could not decrypt this attachment.",
    );
    expect(alert?.textContent).toContain(
      "XChaCha20Poly1305: ciphertext is unauthentic",
    );
    expect(alert?.querySelector(":scope > p")?.textContent).not.toContain("XChaCha20Poly1305");
  });
});
