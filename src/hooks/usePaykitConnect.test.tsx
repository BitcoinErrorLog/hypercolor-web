/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  resetPaykitConnectLive,
  resetPaykitConnectLiveForTests,
  usePaykitConnect,
} from "./usePaykitConnect";
import { pendingChannelMatches, startPaykitConnect } from "@/services/RingConnect";
import { watchCombinedGrant } from "@/services/singleApproval";
import { KeyStore } from "@/services/KeyStore";

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

let host: HTMLDivElement;
let root: Root;
let mintCount = 0;
let pollReject: ((reason: unknown) => void) | undefined;

function Probe() {
  const connect = usePaykitConnect({ autoStart: true });
  return (
    <div>
      <p data-testid="ch">{connect.ch}</p>
      <button
        type="button"
        data-testid="replace"
        onClick={() => void connect.start({ replace: true })}
      />
      <button
        type="button"
        data-testid="show-qr"
        onClick={() => void connect.showQrAgain()}
      />
    </div>
  );
}

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

async function flushStart() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("usePaykitConnect remount", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mintCount = 0;
    pollReject = undefined;
    resetPaykitConnectLiveForTests();
    vi.mocked(startPaykitConnect).mockReset().mockImplementation(async () => {
      mintCount += 1;
      return {
        url: `pubkyring://paykit-connect?n=${mintCount}`,
        ch: `stable-ch-${mintCount}`,
        deviceId: "hypercolor-web-test",
        deadlineMs: Date.now() + 60_000,
        ephemeralPkHex: "aa".repeat(32),
        authFlow: {
          authorizationUrl: () => "",
          awaitApproval: () => new Promise(() => undefined),
          free: () => undefined,
          [Symbol.dispose]: () => undefined,
        },
      };
    });
    vi.mocked(watchCombinedGrant).mockReset().mockImplementation(
      () =>
        new Promise((_, reject) => {
          pollReject = reject;
        }),
    );
    vi.mocked(pendingChannelMatches).mockReset().mockResolvedValue(true);
    vi.mocked(KeyStore.clearPendingRingHandoff).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    resetPaykitConnectLiveForTests();
  });

  it("does not mint a new channel when the hook remounts while the poll is live", async () => {
    await render(<Probe />);
    await flushStart();
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=ch]")?.textContent).toBe("stable-ch-1");
    });
    expect(mintCount).toBe(1);

    act(() => {
      root.unmount();
    });
    root = createRoot(host);
    await render(<Probe />);
    await flushStart();
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=ch]")?.textContent).toBe("stable-ch-1");
    });
    expect(mintCount).toBe(1);
    expect(startPaykitConnect).toHaveBeenCalledTimes(1);
  });

  it("remints after a dead poll then remount", async () => {
    await render(<Probe />);
    await flushStart();
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=ch]")?.textContent).toBe("stable-ch-1");
    });
    expect(mintCount).toBe(1);

    await act(async () => {
      pollReject?.(new Error("relay down"));
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      root.unmount();
    });
    root = createRoot(host);
    await render(<Probe />);
    await flushStart();
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=ch]")?.textContent).toBe("stable-ch-2");
    });
    expect(mintCount).toBe(2);
  });

  it("remints after sign-out then remount", async () => {
    await render(<Probe />);
    await flushStart();
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=ch]")?.textContent).toBe("stable-ch-1");
    });
    expect(mintCount).toBe(1);

    resetPaykitConnectLive();
    vi.mocked(pendingChannelMatches).mockResolvedValue(false);

    act(() => {
      root.unmount();
    });
    root = createRoot(host);
    await render(<Probe />);
    await flushStart();
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=ch]")?.textContent).toBe("stable-ch-2");
    });
    expect(mintCount).toBe(2);
  });

  it("clears the previous pending secret when replace is true", async () => {
    await render(<Probe />);
    await flushStart();
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=ch]")?.textContent).toBe("stable-ch-1");
    });

    await act(async () => {
      host.querySelector("[data-testid=replace]")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushStart();
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=ch]")?.textContent).toBe("stable-ch-2");
    });
    expect(KeyStore.clearPendingRingHandoff).toHaveBeenCalledWith("stable-ch-1");
    expect(mintCount).toBe(2);
  });

  it("does not re-await a settled wasm flow when showing the QR again", async () => {
    await render(<Probe />);
    await flushStart();
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=ch]")?.textContent).toBe("stable-ch-1");
    });
    await act(async () => {
      pollReject?.(new Error("relay down"));
      await Promise.resolve();
      await Promise.resolve();
    });
    const watchesBefore = vi.mocked(watchCombinedGrant).mock.calls.length;
    await act(async () => {
      host.querySelector("[data-testid=show-qr]")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushStart();
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=ch]")?.textContent).toBe("stable-ch-2");
    });
    expect(mintCount).toBe(2);
    expect(vi.mocked(watchCombinedGrant).mock.calls.length).toBeGreaterThan(watchesBefore);
  });
});
