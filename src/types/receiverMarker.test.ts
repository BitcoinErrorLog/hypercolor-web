import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  capabilityPath,
  parseCapabilitiesJsonDetailed,
  parseCapabilitiesJson,
  parseLegacyChatKindsVDetailed,
  parseLegacyChatKindsV,
  parseReceiverMarkerJson,
} from "./receiverMarker";

const fixture = (name: string) =>
  readFileSync(new URL(`../test/fixtures/receiver-marker/${name}`, import.meta.url), "utf8");

describe("strict receiver marker and capability documents", () => {
  it("accepts the production marker fixture", () => {
    expect(parseReceiverMarkerJson(fixture("receiver-marker.valid.json"))).toMatchObject({
      version: 1,
      receiverPath: "hypercolor/wallet",
      noisePublicKey: expect.any(String),
    });
  });

  it("rejects unknown fields and the wrong receiver path", () => {
    expect(parseReceiverMarkerJson(fixture("receiver-marker.unknown-field.json"))).toBeNull();
    expect(parseReceiverMarkerJson(fixture("receiver-marker.wrong-receiver-path.json"))).toBeNull();
    expect(parseReceiverMarkerJson('{"version":1,"version":1}')).toBeNull();
  });

  it("accepts only the canonical capability fixture", () => {
    expect(parseCapabilitiesJson(fixture("capability.valid.json"))).toMatchObject({
      version: 1,
      chatKindsV: 1,
    });
    expect(parseCapabilitiesJson(fixture("capability.invalid.json"))).toBeNull();
    expect(parseCapabilitiesJson(fixture("capability.wrong-version.json"))).toBeNull();
    expect(parseCapabilitiesJson(fixture("capability.oversized.json"))).toBeNull();
    expect(parseCapabilitiesJsonDetailed(fixture("capability.oversized.json"))).toEqual({
      ok: false,
      error: "TOO_LARGE",
    });
  });

  it("keeps legacy parsing isolated to chat_kinds_v", () => {
    expect(parseLegacyChatKindsV('{"chat_kinds_v":1,"noise_public_key":"ignored"}')).toBe(1);
    expect(capabilityPath("noise")).toBe(
      "/pub/hypercolor.app/v1/receivers/noise/capabilities.json",
    );
  });

  it("accepts version text in legacy values and nested keys", () => {
    expect(parseLegacyChatKindsVDetailed('{"note":"\\"version\\": not a key"}')).toBe(0);
    expect(parseLegacyChatKindsVDetailed('{"nested":{"version":1},"chat_kinds_v":1}')).toBe(1);
  });

  it("rejects duplicate top-level legacy keys", () => {
    expect(parseLegacyChatKindsVDetailed('{"chat_kinds_v":1,"chat_kinds_v":0}')).toBeNull();
  });
});
