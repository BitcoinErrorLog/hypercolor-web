import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_HTTP_RELAY } from "@/lib/http-relay";
import { hexToBytes } from "@/lib/hex";
import { deriveRingCallbackChannelId } from "./ringChannelId";
import {
  RELAY_MAX_CONSECUTIVE_FAILURES,
  pollLink,
  postLink,
  relayChannelId,
  relayChannelUrl,
  setRelayFetchForTests,
} from "./relayChannel";

describe("relay channel keying", () => {
  afterEach(() => {
    setRelayFetchForTests(null);
  });

  it("prefixes the digest with hc- and joins the default relay base", () => {
    expect(relayChannelId("abc")).toBe("hc-abc");
    expect(relayChannelId("hc-abc")).toBe("hc-abc");
    expect(relayChannelUrl("abc")).toBe(`${DEFAULT_HTTP_RELAY}/hc-abc`);
  });

  it("derives ch as base64url_nopad(SHA-256(prefix || pk_bytes))", async () => {
    const pk = hexToBytes("11".repeat(32));
    const ch = await deriveRingCallbackChannelId(pk);
    expect(ch).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(ch.includes("=")).toBe(false);
    expect(await deriveRingCallbackChannelId(pk)).toBe(ch);

    const other = hexToBytes("22".repeat(32));
    expect(await deriveRingCallbackChannelId(other)).not.toBe(ch);
  });

  it("retries timeouts and rejects after bounded consecutive failures", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("ok").buffer,
      });
    setRelayFetchForTests(fetchMock as unknown as typeof fetch);
    const body = await pollLink("abc", { deadlineMs: Date.now() + 5_000 });
    expect(new TextDecoder().decode(body)).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    setRelayFetchForTests(failing as unknown as typeof fetch);
    await expect(pollLink("abc", { deadlineMs: Date.now() + 5_000 })).rejects.toThrow(
      "offline",
    );
    expect(failing).toHaveBeenCalledTimes(RELAY_MAX_CONSECUTIVE_FAILURES);
  });

  it("POSTs JSON public params to the hc- channel", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    setRelayFetchForTests(fetchMock as unknown as typeof fetch);
    await postLink("abc", JSON.stringify({ mode: "secure_handoff" }));
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_HTTP_RELAY}/hc-abc`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});
