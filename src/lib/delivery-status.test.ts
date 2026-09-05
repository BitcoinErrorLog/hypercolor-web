import { describe, expect, it } from "vitest";
import type { LinkDeliveryState } from "@/types/link";
import {
  formatDeliveryStatus,
  isStandbyNewChatBlocked,
  queuedThreadSubtitle,
  QUEUED_HANDSHAKE_SUBTITLE,
  QUEUED_STANDBY_SUBTITLE,
} from "./delivery-status";

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
    expect(
      queuedThreadSubtitle({
        linkStatus: "handshaking",
        lastDeliveryState: "sending",
        receiverRole: "standby",
      }),
    ).toBe(QUEUED_STANDBY_SUBTITLE);
  });

  it("blocks new chats on standby unless the link is already established", () => {
    expect(isStandbyNewChatBlocked("standby", null)).toBe(true);
    expect(isStandbyNewChatBlocked("standby", "handshaking")).toBe(true);
    expect(isStandbyNewChatBlocked("standby", "established")).toBe(false);
    expect(isStandbyNewChatBlocked("active", null)).toBe(false);
  });
});
