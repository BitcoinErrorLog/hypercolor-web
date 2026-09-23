import { describe, expect, it } from "vitest";
import { RING_GRANT_CAPABILITIES } from "@/types/link";
import { parsePubkyauthAuthorizationUrl } from "./pubkyauthUrl";

const RELAY = "https://httprelay.pubky.app/link/abc";

function url(caps: string, relay = RELAY): string {
  return `pubkyauth:///?caps=${encodeURIComponent(caps)}&secret=sekrit&relay=${encodeURIComponent(relay)}`;
}

describe("parsePubkyauthAuthorizationUrl", () => {
  it("accepts the Ring grant and a reordered covering grant", () => {
    const canonical = parsePubkyauthAuthorizationUrl(url(RING_GRANT_CAPABILITIES));
    expect(canonical.relay).toBe(RELAY);
    expect(canonical.secret).toBe("sekrit");
    const reordered = parsePubkyauthAuthorizationUrl(
      url("/pub/hypercolor.app/v1/:rw,/pub/paykit/:rw"),
    );
    expect(reordered.caps).toContain("/pub/paykit/:rw");
  });

  it("accepts a broader /pub/:rw grant", () => {
    expect(parsePubkyauthAuthorizationUrl(url("/pub/:rw")).caps).toBe("/pub/:rw");
  });

  it("FAILS when the Hypercolor tree is missing", () => {
    expect(() => parsePubkyauthAuthorizationUrl(url("/pub/paykit/:rw"))).toThrow(
      "pubkyauth caps do not cover RING_GRANT_CAPABILITIES",
    );
  });

  it("FAILS a relay that is not httprelay.pubky.app", () => {
    expect(() =>
      parsePubkyauthAuthorizationUrl(url(RING_GRANT_CAPABILITIES, "https://evil.example/link")),
    ).toThrow("pubkyauth relay host is not allowlisted");
  });

  it("FAILS a non-https relay", () => {
    expect(() =>
      parsePubkyauthAuthorizationUrl(
        url(RING_GRANT_CAPABILITIES, "http://httprelay.pubky.app/link"),
      ),
    ).toThrow("pubkyauth relay must be https");
  });
});
