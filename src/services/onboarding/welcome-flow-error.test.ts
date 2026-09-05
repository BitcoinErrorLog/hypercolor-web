/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { PaykitLinkWeb } from "@/services/link/PaykitLinkWeb";
import {
  resetPaykitConnectLiveForTests,
  setLivePaykitConnect,
} from "@/services/paykitConnectLive";
import { welcomeFlowErrorSignOutTarget } from "./welcomeActions";

describe("N3 welcome flow error sign-out", () => {
  afterEach(() => {
    resetPaykitConnectLiveForTests();
    vi.restoreAllMocks();
  });

  it("does not target the global live session when reminting a QR hits a flow error", async () => {
    const liveSession = { pubky: () => "live-user" };
    const flowSession = { pubky: () => "flow-session" };
    setLivePaykitConnect({
      started: {
        ch: "ch",
        url: "pubkyauth://",
        deviceId: "d",
        deadlineMs: Date.now() + 60_000,
        ephemeralPkHex: "aa",
        authFlow: {} as never,
      },
      abort: new AbortController(),
      authFlow: { handle: {} as never, canceled: false, session: flowSession as never },
    });

    const signOut = vi.spyOn(PaykitLinkWeb, "signOutSession").mockResolvedValue(undefined);
    const target = welcomeFlowErrorSignOutTarget();
    expect(target).toBe(flowSession);
    expect(target).not.toBe(liveSession);
    if (target) await PaykitLinkWeb.signOutSession(target);
    expect(signOut).toHaveBeenCalledWith(flowSession);
    expect(signOut).not.toHaveBeenCalledWith(liveSession);
  });

  it("signs out nothing when the tracked flow has no session (signed-in remint with live cookie only)", () => {
    setLivePaykitConnect({
      started: {
        ch: "ch",
        url: "pubkyauth://",
        deviceId: "d",
        deadlineMs: Date.now() + 60_000,
        ephemeralPkHex: "aa",
        authFlow: {} as never,
      },
      abort: new AbortController(),
      authFlow: { handle: {} as never, canceled: false, session: undefined },
    });
    expect(welcomeFlowErrorSignOutTarget()).toBeNull();
  });
});
