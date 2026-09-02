import { describe, expect, it } from "vitest";
import type { LinkDeliveryState } from "@/types/link";
import { formatDeliveryStatus, isFailedDelivery } from "./delivery-status";

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

  it("treats only failed as retryable", () => {
    expect(isFailedDelivery("failed")).toBe(true);
    expect(isFailedDelivery("sent")).toBe(false);
    expect(isFailedDelivery("delivered")).toBe(false);
  });
});
