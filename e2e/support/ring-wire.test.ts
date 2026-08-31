import { describe, expect, it } from "vitest";
import { getHttpRelayBase } from "@/lib/http-relay";
import { HANDOFF_PATH_PREFIX, HANDOFF_TTL_MS } from "@/services/RingConnect";
import { STAGING_HOMESERVER_Z32 } from "@/services/link/ownerRoundtrip";
import {
  RELAY_CHANNEL_PREFIX as SRC_RELAY_PREFIX,
  relayChannelUrl as srcRelayChannelUrl,
} from "@/services/relayChannel";
import {
  HANDOFF_PATH_PREFIX as WIRE_PATH,
  HANDOFF_TTL_MS as WIRE_TTL,
  RELAY_CHANNEL_PREFIX,
  STAGING_HOMESERVER_Z32 as WIRE_HS,
  relayChannelUrl,
} from "./ring-wire";

describe("ring-wire", () => {
  it("matches src handoff, homeserver, and httprelay URL construction", () => {
    expect(WIRE_PATH).toBe(HANDOFF_PATH_PREFIX);
    expect(WIRE_TTL).toBe(HANDOFF_TTL_MS);
    expect(WIRE_HS).toBe(STAGING_HOMESERVER_Z32);
    expect(RELAY_CHANNEL_PREFIX).toBe(SRC_RELAY_PREFIX);
    expect(relayChannelUrl("abcd")).toBe(srcRelayChannelUrl("abcd"));
    expect(relayChannelUrl("hc-abcd")).toBe(srcRelayChannelUrl("hc-abcd"));
    expect(relayChannelUrl("abcd", getHttpRelayBase())).toBe(
      srcRelayChannelUrl("abcd", getHttpRelayBase()),
    );
  });
});
