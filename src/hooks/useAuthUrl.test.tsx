/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RING_GRANT_CAPABILITIES } from "@/types/link";
import { useAuthUrl } from "./useAuthUrl";

const startAuthFlow = vi.fn();
const awaitAuthApproval = vi.fn();
const signOutSession = vi.fn();
const adoptApprovedSession = vi.fn();

vi.mock("@/services/link/PaykitLinkWeb", () => ({
  PaykitLinkWeb: {
    startAuthFlow: (...args: unknown[]) => startAuthFlow(...args),
    awaitAuthApproval: (...args: unknown[]) => awaitAuthApproval(...args),
    signOutSession: (...args: unknown[]) => signOutSession(...args),
  },
}));

vi.mock("@/services/link/session", () => ({
  adoptApprovedSession: (...args: unknown[]) => adoptApprovedSession(...args),
}));

const RELAY = "https://httprelay.pubky.app/link/abc";

function authUrl(caps: string): string {
  return `pubkyauth:///?caps=${encodeURIComponent(caps)}&secret=sekrit&relay=${encodeURIComponent(RELAY)}`;
}

function Probe({
  adoptOnApproval,
  onApproved,
  onError,
}: {
  adoptOnApproval?: boolean;
  onApproved: (session: { pubky: () => string }) => void;
  onError: (error: unknown) => void;
}) {
  useAuthUrl({ autoFetch: true, adoptOnApproval, onApproved, onError });
  return null;
}

let host: HTMLDivElement;
let root: Root;

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useAuthUrl pubkyauth gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    startAuthFlow.mockReset();
    awaitAuthApproval.mockReset();
    signOutSession.mockReset();
    adoptApprovedSession.mockReset();
    awaitAuthApproval.mockImplementation(() => new Promise(() => undefined));
    adoptApprovedSession.mockImplementation(async (session: { pubky: () => string }) => ({
      pubky: session.pubky(),
      handle: session,
    }));
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.useRealTimers();
  });

  it("FAILS a narrow grant before polling and frees the flow", async () => {
    const free = vi.fn();
    startAuthFlow.mockResolvedValue({
      authorizationUrl: () => authUrl("/pub/paykit/:rw"),
      free,
    });
    const onError = vi.fn();
    const onApproved = vi.fn();
    await render(<Probe onApproved={onApproved} onError={onError} />);
    expect(startAuthFlow).toHaveBeenCalledWith(RING_GRANT_CAPABILITIES);
    expect(free).toHaveBeenCalledTimes(1);
    expect(awaitAuthApproval).not.toHaveBeenCalled();
    expect(onApproved).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String((onError.mock.calls[0]?.[0] as Error).message)).toContain(
      "pubkyauth caps do not cover RING_GRANT_CAPABILITIES",
    );
  });

  it("polls a covering grant and adopts by default", async () => {
    const session = { pubky: () => "owner", free: vi.fn() };
    let resolveApproval: (value: unknown) => void = () => undefined;
    awaitAuthApproval.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApproval = resolve;
        }),
    );
    startAuthFlow.mockResolvedValue({
      authorizationUrl: () => authUrl(RING_GRANT_CAPABILITIES),
      free: vi.fn(),
    });
    const onApproved = vi.fn();
    await render(<Probe onApproved={onApproved} onError={vi.fn()} />);
    expect(awaitAuthApproval).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveApproval(session);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(adoptApprovedSession).toHaveBeenCalledWith(session);
    expect(onApproved).toHaveBeenCalledWith(session);
  });

  it("skips adopt when the caller confirms first", async () => {
    const session = { pubky: () => "owner", free: vi.fn() };
    awaitAuthApproval.mockResolvedValue(session);
    startAuthFlow.mockResolvedValue({
      authorizationUrl: () => authUrl("/pub/:rw"),
      free: vi.fn(),
    });
    const onApproved = vi.fn();
    await render(
      <Probe adoptOnApproval={false} onApproved={onApproved} onError={vi.fn()} />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(adoptApprovedSession).not.toHaveBeenCalled();
    expect(onApproved).toHaveBeenCalledWith(session);
  });
});
