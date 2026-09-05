/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resetPaykitConnectLiveForTests, usePaykitConnect } from "./usePaykitConnect";
import { startPaykitConnect, waitForHandoffParams } from "@/services/RingConnect";

vi.mock("@/services/RingConnect", () => ({
  HANDOFF_TTL_MS: 5 * 60 * 1000,
  startPaykitConnect: vi.fn(),
  waitForHandoffParams: vi.fn(),
}));

vi.mock("@/services/KeyStore", () => ({
  KeyStore: {
    clearPendingRingHandoff: vi.fn(() => Promise.resolve()),
  },
}));

let host: HTMLDivElement;
let root: Root;
let mintCount = 0;

function Probe() {
  const connect = usePaykitConnect({ autoStart: true });
  return <p data-testid="ch">{connect.ch}</p>;
}

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

describe("usePaykitConnect remount", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mintCount = 0;
    resetPaykitConnectLiveForTests();
    vi.mocked(startPaykitConnect).mockReset().mockImplementation(async () => {
      mintCount += 1;
      return {
        url: `pubkyring://paykit-connect?n=${mintCount}`,
        ch: `stable-ch-${mintCount}`,
        deviceId: "hypercolor-web-test",
        deadlineMs: Date.now() + 60_000,
        ephemeralPkHex: "aa".repeat(32),
      };
    });
    vi.mocked(waitForHandoffParams).mockReset().mockImplementation(
      () => new Promise(() => undefined),
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    resetPaykitConnectLiveForTests();
  });

  it("does not mint a new channel when the hook remounts", async () => {
    await render(<Probe />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=ch]")?.textContent).toBe("stable-ch-1");
    });
    expect(mintCount).toBe(1);

    act(() => {
      root.unmount();
    });
    root = createRoot(host);
    await render(<Probe />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=ch]")?.textContent).toBe("stable-ch-1");
    });
    expect(mintCount).toBe(1);
    expect(startPaykitConnect).toHaveBeenCalledTimes(1);
  });
});
