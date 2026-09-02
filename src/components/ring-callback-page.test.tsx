/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RingCallbackPage } from "@/components/ring-callback-page";
import { KeyStore } from "@/services/KeyStore";
import {
  adoptHandoff,
  decryptPendingHandoff,
  pendingChannelMatches,
  publishHandoffParamsToRelay,
  validateHandoffPublicParams,
} from "@/services/RingConnect";

vi.mock("@/services/KeyStore", () => ({
  KeyStore: {
    initKeyStore: vi.fn(),
  },
}));

vi.mock("@/services/RingConnect", () => ({
  adoptHandoff: vi.fn(),
  decryptPendingHandoff: vi.fn(),
  pendingChannelMatches: vi.fn(),
  publishHandoffParamsToRelay: vi.fn(),
  validateHandoffPublicParams: vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

function primaryErrorText(): string | undefined {
  return host.querySelector('[role="alert"] > p')?.textContent ?? undefined;
}

function detailsText(): string {
  return host.querySelector('[role="alert"] details')?.textContent ?? "";
}

describe("RingCallbackPage errors", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    window.history.replaceState({}, "", "/ring-callback?ch=test-channel");
    vi.mocked(KeyStore.initKeyStore).mockReset().mockResolvedValue(undefined);
    vi.mocked(validateHandoffPublicParams).mockReset().mockReturnValue({
      pubky: "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
      requestId: "req-1",
      mode: "auth",
      homeserver: "homeserver.staging.pubky.app",
    });
    vi.mocked(pendingChannelMatches).mockReset();
    vi.mocked(decryptPendingHandoff).mockReset();
    vi.mocked(publishHandoffParamsToRelay).mockReset();
    vi.mocked(adoptHandoff).mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("renders canonical key-store copy with the raw message in Details", async () => {
    vi.mocked(KeyStore.initKeyStore).mockRejectedValueOnce(
      new Error("IndexedDB version error 17"),
    );
    await render(<RingCallbackPage />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(primaryErrorText()).toBe("Could not open the key store.");
    expect(detailsText()).toContain("IndexedDB version error 17");
    expect(primaryErrorText()).not.toContain("IndexedDB");
  });

  it("renders canonical handoff copy when decrypt fails", async () => {
    vi.mocked(pendingChannelMatches).mockResolvedValueOnce(true);
    vi.mocked(decryptPendingHandoff).mockRejectedValueOnce(
      new Error("box open failed: nonce"),
    );
    await render(<RingCallbackPage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(primaryErrorText()).toBe("Could not complete this Ring handoff.");
    expect(detailsText()).toContain("box open failed: nonce");
    expect(primaryErrorText()).not.toContain("nonce");
  });

  it("renders canonical relay copy when notify fails", async () => {
    vi.mocked(pendingChannelMatches).mockResolvedValueOnce(false);
    vi.mocked(publishHandoffParamsToRelay).mockRejectedValueOnce(
      new Error("httprelay 502 from edge"),
    );
    await render(<RingCallbackPage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(primaryErrorText()).toBe("Could not notify the waiting computer.");
    expect(detailsText()).toContain("httprelay 502 from edge");
    expect(primaryErrorText()).not.toContain("httprelay");
  });

  it("renders canonical handoff copy when adopt fails", async () => {
    vi.mocked(pendingChannelMatches).mockResolvedValueOnce(true);
    vi.mocked(decryptPendingHandoff).mockResolvedValueOnce({
      version: 1,
      pubky: "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
      noise_keypairs: [],
      inbox_keypair: { public_key: "pk", secret_key: "sk" },
      expires_at: Date.now() + 60_000,
    });
    vi.mocked(adoptHandoff).mockRejectedValueOnce(new Error("session adopt exploded"));
    await render(<RingCallbackPage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector("button")?.click();
    });
    expect(primaryErrorText()).toBe("Could not complete this Ring handoff.");
    expect(detailsText()).toContain("session adopt exploded");
    expect(primaryErrorText()).not.toContain("exploded");
  });
});
