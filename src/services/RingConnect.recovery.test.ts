/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { hexToBytes } from "@/lib/hex";
import { KeyStore } from "./KeyStore";
import { deriveRingCallbackChannelId } from "./ringChannelId";
import {
  clearPendingHandoffLocator,
  rememberPendingHandoffLocator,
  readPendingHandoffLocator,
  tryAdoptPendingHandoffForSession,
} from "./RingConnect";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";

const params = {
  pubky: OWNER,
  requestId: "ab".repeat(32),
  mode: "secure_handoff+pubkyauth",
  homeserver: HOMESERVER,
};

describe("tryAdoptPendingHandoffForSession recovery", () => {
  afterEach(() => {
    clearPendingHandoffLocator();
    vi.restoreAllMocks();
  });

  async function bindChannel(): Promise<string> {
    const pk = "11".repeat(32);
    const ch = await deriveRingCallbackChannelId(hexToBytes(pk));
    vi.spyOn(KeyStore, "getPendingRingHandoffPublicKey").mockResolvedValue(pk);
    rememberPendingHandoffLocator(ch, params);
    return ch;
  }

  it("returns false on an expired payload and clears the locator", async () => {
    const ch = await bindChannel();
    vi.spyOn(KeyStore, "getPendingRingHandoff").mockRejectedValue(
      new Error("Handoff payload has expired"),
    );
    await expect(tryAdoptPendingHandoffForSession(OWNER)).resolves.toBe(false);
    expect(readPendingHandoffLocator()).toBeNull();
    expect(ch).toBeTruthy();
  });

  it("keeps the locator when fetch throws so recovery can run", async () => {
    const ch = await bindChannel();
    vi.spyOn(KeyStore, "getPendingRingHandoff").mockRejectedValue(new Error("homeserver 500"));
    await expect(tryAdoptPendingHandoffForSession(OWNER)).rejects.toThrow("homeserver 500");
    expect(readPendingHandoffLocator()?.ch).toBe(ch);
  });
});
