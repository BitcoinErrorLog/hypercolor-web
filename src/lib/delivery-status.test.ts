import { describe, expect, it } from "vitest";
import type { LinkDeliveryState } from "@/types/link";
import { formatDeliveryStatus, isFailedDelivery, queuedThreadSubtitle, QUEUED_HANDSHAKE_SUBTITLE } from "./delivery-status";

describe("formatDeliveryStatus", () => {
  const cases: Array<[LinkDeliveryState, string]> = [
    ["sending", "Queued"],
    ["sent", "Sent"],
    ["delivered", "Sent"],
    ["read", "Sent"],
    ["failed", "Failed"],
  ];

  it.each(cases)("maps %s to %s", (state, label) => {
    expect(formatDeliveryStatus(state)).toBe(label);
  });

  it("never emits delivered or read", () => {
    for (const state of ["sending", "sent", "delivered", "read", "failed"] as const) {
      const label = formatDeliveryStatus(state);
      expect(label.toLowerCase()).not.toBe("delivered");
      expect(label.toLowerCase()).not.toBe("read");
    }
  });

  it("maps unknown states to Queued so Sent is never claimed before ready", () => {
    expect(formatDeliveryStatus("sending")).toBe("Queued");
    expect(queuedThreadSubtitle({ linkStatus: "handshaking", lastDeliveryState: "sending" })).toBe(
      QUEUED_HANDSHAKE_SUBTITLE,
    );
    expect(queuedThreadSubtitle({ linkStatus: "established", lastDeliveryState: "sent" })).toBeNull();
  });
});
