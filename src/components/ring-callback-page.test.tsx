/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RingCallbackPage } from "@/components/ring-callback-page";
import { KeyStore } from "@/services/KeyStore";
import {
  decryptPendingHandoff,
  pendingChannelMatches,
  publishHandoffParamsToRelay,
  validateHandoffPublicParams,
} from "@/services/RingConnect";
import { finishLegacyChainedGrant, finishSingleApproval } from "@/services/singleApproval";
import { getLivePaykitConnect } from "@/services/paykitConnectLive";
import { getLiveSession } from "@/services/link/session";

vi.mock("@/services/KeyStore", () => ({
  KeyStore: {
    initKeyStore: vi.fn(),
  },
}));

vi.mock("@/services/RingConnect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/RingConnect")>();
  return {
    ...actual,
    decryptPendingHandoff: vi.fn(),
    pendingChannelMatches: vi.fn(),
    publishHandoffParamsToRelay: vi.fn(),
    validateHandoffPublicParams: vi.fn(),
  };
});

vi.mock("@/services/singleApproval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/singleApproval")>();
  return {
    ...actual,
    finishSingleApproval: vi.fn(),
    finishLegacyChainedGrant: vi.fn(),
  };
});

vi.mock("@/services/paykitConnectLive", () => ({
  getLivePaykitConnect: vi.fn(() => null),
}));

vi.mock("@/services/link/session", () => ({
  getLiveSession: vi.fn(() => null),
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
      mode: "secure_handoff",
      homeserver: "homeserver.staging.pubky.app",
    });
    vi.mocked(pendingChannelMatches).mockReset();
    vi.mocked(decryptPendingHandoff).mockReset();
    vi.mocked(publishHandoffParamsToRelay).mockReset();
    vi.mocked(finishSingleApproval).mockReset();
    vi.mocked(finishLegacyChainedGrant).mockReset();
    vi.mocked(getLivePaykitConnect).mockReset().mockReturnValue(null);
    vi.mocked(getLiveSession).mockReset().mockReturnValue(null);
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
    expect(detailsText()).toContain("protocol error");
    expect(detailsText()).not.toContain("IndexedDB");
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
    expect(detailsText()).toContain("protocol error");
    expect(detailsText()).not.toContain("nonce");
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
    expect(detailsText()).toContain("network error");
    expect(detailsText()).not.toContain("httprelay");
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
    vi.mocked(getLiveSession).mockReturnValue({
      pubky: "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
      handle: { pubky: () => "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq" },
    } as never);
    vi.mocked(finishLegacyChainedGrant).mockRejectedValueOnce(new Error("session adopt exploded"));
    await render(<RingCallbackPage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector("button")?.click();
    });
    expect(primaryErrorText()).toBe("Could not complete this Ring handoff.");
    expect(detailsText()).toContain("protocol error");
    expect(detailsText()).not.toContain("exploded");
    expect(primaryErrorText()).not.toContain("exploded");
  });

  it("refuses combined adopt without a live tracked session and never persists keys", async () => {
    vi.mocked(validateHandoffPublicParams).mockReturnValue({
      pubky: "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
      requestId: "req-1",
      mode: "secure_handoff+pubkyauth",
      homeserver: "homeserver.staging.pubky.app",
    });
    vi.mocked(pendingChannelMatches).mockResolvedValueOnce(true);
    vi.mocked(decryptPendingHandoff).mockResolvedValueOnce({
      version: 1,
      pubky: "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
      noise_keypairs: [],
      inbox_keypair: { public_key: "pk", secret_key: "sk" },
      expires_at: Date.now() + 60_000,
    });
    await render(<RingCallbackPage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector("button")?.click();
    });
    expect(finishSingleApproval).not.toHaveBeenCalled();
    expect(finishLegacyChainedGrant).not.toHaveBeenCalled();
    expect(primaryErrorText()).toBe("Could not complete this Ring handoff.");
  });

  it("routes combined adopt through finishSingleApproval when the tracked flow has a session", async () => {
    const handle = { pubky: () => "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq" };
    vi.mocked(getLivePaykitConnect).mockReturnValue({
      started: { ch: "test-channel", url: "", deviceId: "d", deadlineMs: Date.now() + 1000, ephemeralPkHex: "aa", authFlow: {} },
      abort: new AbortController(),
      authFlow: { handle: {} as never, canceled: false, session: handle as never },
    } as never);
    vi.mocked(validateHandoffPublicParams).mockReturnValue({
      pubky: "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
      requestId: "req-1",
      mode: "secure_handoff+pubkyauth",
      homeserver: "homeserver.staging.pubky.app",
    });
    vi.mocked(pendingChannelMatches).mockResolvedValueOnce(true);
    vi.mocked(decryptPendingHandoff).mockResolvedValueOnce({
      version: 1,
      pubky: "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
      noise_keypairs: [],
      inbox_keypair: { public_key: "pk", secret_key: "sk" },
      expires_at: Date.now() + 60_000,
    });
    vi.mocked(finishSingleApproval).mockResolvedValueOnce({
      pubky: "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
      homeserver: "homeserver.staging.pubky.app",
    });
    await render(<RingCallbackPage />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector("button")?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(finishSingleApproval).toHaveBeenCalled();
    expect(finishLegacyChainedGrant).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Identity stored");
  });
});

