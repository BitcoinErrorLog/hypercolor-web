/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PaykitLinkWeb } from "@/services/link/PaykitLinkWeb";
import { pendingChannelMatches, startPaykitConnect } from "@/services/RingConnect";
import { getLivePaykitConnect } from "@/services/paykitConnectLive";
import { watchCombinedGrant } from "@/services/singleApproval";
import { KeyStore } from "@/services/KeyStore";
import {
  resetPaykitConnectLiveForTests,
  usePaykitConnect,
} from "@/hooks/usePaykitConnect";

vi.mock("@/services/RingConnect", () => ({
  HANDOFF_TTL_MS: 5 * 60 * 1000,
  startPaykitConnect: vi.fn(),
  pendingChannelMatches: vi.fn(),
}));

vi.mock("@/services/singleApproval", () => ({
  watchCombinedGrant: vi.fn(),
}));

vi.mock("@/services/KeyStore", () => ({
  KeyStore: {
    clearPendingRingHandoff: vi.fn(() => Promise.resolve()),
  },
}));

function ErrorCatchProbe() {
  usePaykitConnect({
    autoStart: true,
    onError: (_error, flowSession) => {
      if (flowSession) {
        void PaykitLinkWeb.signOutSession(flowSession);
      }
    },
  });
  return <p data-testid="probe">probe</p>;
}

let host: HTMLDivElement;
let root: Root;

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

describe("N3 welcome flow error sign-out", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    resetPaykitConnectLiveForTests();
    vi.mocked(startPaykitConnect).mockReset().mockResolvedValue({
      url: "pubkyring://paykit-connect",
      ch: "tracked-ch",
      deviceId: "hypercolor-web-test",
      deadlineMs: Date.now() + 60_000,
      ephemeralPkHex: "aa".repeat(32),
      authFlow: {
        authorizationUrl: () => "",
        awaitApproval: () => new Promise(() => undefined),
        free: () => undefined,
        [Symbol.dispose]: () => undefined,
      },
    });
    vi.mocked(pendingChannelMatches).mockReset().mockResolvedValue(true);
    vi.mocked(KeyStore.clearPendingRingHandoff).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    resetPaykitConnectLiveForTests();
    vi.restoreAllMocks();
  });

  it("signs out the tracked handle through the real watchCombinedGrant catch path", async () => {
    const flowSession = { pubky: () => "tracked-flow-session" };
    const signOut = vi.spyOn(PaykitLinkWeb, "signOutSession").mockResolvedValue(undefined);
    vi.mocked(watchCombinedGrant).mockReset().mockImplementation(async () => {
      const live = getLivePaykitConnect();
      if (live) live.authFlow.session = flowSession as never;
      throw new Error("watch failed");
    });

    await render(<ErrorCatchProbe />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(signOut).toHaveBeenCalledWith(flowSession);
    });
    expect(getLivePaykitConnect()).toBeNull();
  });
});
