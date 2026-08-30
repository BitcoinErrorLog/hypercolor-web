import { afterEach, describe, expect, it, vi } from "vitest";
import { RING_GRANT_CAPABILITIES } from "@/types/link";
import { DEFAULT_APP_ORIGIN } from "@/lib/app-origin";
import { setRelayFetchForTests } from "./relayChannel";
import {
  buildPaykitConnectUrl,
  parseRelayHandoffBody,
  validateHandoffPublicParams,
  waitForHandoffParams,
} from "./RingConnect";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const HOMESERVER = "8um71us3fyw6h8wbcxb5ar3rwusy1a6u49ba7eabxpqi8gnetewy";

describe("RingConnect URL and params", () => {
  afterEach(() => {
    setRelayFetchForTests(null);
  });

  it("builds paykit-connect with encoded https callback carrying ch", () => {
    const callbackUrl = `${DEFAULT_APP_ORIGIN}/ring-callback?ch=abc`;
    const url = buildPaykitConnectUrl({
      deviceId: "hypercolor-web-1",
      ephemeralPkHex: "aa".repeat(32),
      callbackUrl,
    });
    expect(url.startsWith("pubkyring://paykit-connect?")).toBe(true);
    const parsed = new URL(url.replace("pubkyring://", "https://ring/"));
    expect(parsed.searchParams.get("deviceId")).toBe("hypercolor-web-1");
    expect(parsed.searchParams.get("ephemeralPk")).toBe("aa".repeat(32));
    expect(parsed.searchParams.get("caps")).toBe(RING_GRANT_CAPABILITIES);
    expect(parsed.searchParams.get("callback")).toBe(callbackUrl);
  });

  it("accepts the public param set Ring emits and rejects junk", () => {
    const valid = {
      pubky: OWNER,
      request_id: "ab".repeat(32),
      mode: "secure_handoff",
      homeserver: HOMESERVER,
    };
    expect(validateHandoffPublicParams(valid)).toEqual({
      pubky: OWNER,
      requestId: "ab".repeat(32),
      mode: "secure_handoff",
      homeserver: HOMESERVER,
    });
    expect(validateHandoffPublicParams({ ...valid, mode: "plain" })).toBeNull();
    expect(validateHandoffPublicParams({ ...valid, pubky: "not-a-key" })).toBeNull();
    expect(validateHandoffPublicParams({ ...valid, request_id: "zzz" })).toBeNull();
    expect(
      parseRelayHandoffBody(new TextEncoder().encode("not-json")),
    ).toBeNull();
    expect(
      parseRelayHandoffBody(new TextEncoder().encode(JSON.stringify(valid))),
    ).not.toBeNull();
  });

  it("rejects junk on the channel and completes on the next valid message", async () => {
    const valid = {
      pubky: OWNER,
      request_id: "ab".repeat(32),
      mode: "secure_handoff",
      homeserver: HOMESERVER,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("not-json").buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          new TextEncoder().encode(JSON.stringify(valid)).buffer,
      });
    setRelayFetchForTests(fetchMock as unknown as typeof fetch);
    const params = await waitForHandoffParams("abc", Date.now() + 5_000);
    expect(params.pubky).toBe(OWNER);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
