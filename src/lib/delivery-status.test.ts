import { describe, expect, it } from "vitest";
import type { LinkDeliveryState } from "@/types/link";
import {
  formatDeliveryStatus,
  isStandbyNewChatBlocked,
  queuedThreadSubtitle,
  QUEUED_HANDSHAKE_SUBTITLE,
  QUEUED_STANDBY_SUBTITLE,
  CONNECTION_CHANGED_RETRY,
} from "./delivery-status";

describe("formatDeliveryStatus", () => {
  const cases: Array<[LinkDeliveryState, string]> = [
    ["sending", "Queued"],
    ["sent", "Sent"],
    ["delivered", "Delivered"],
    ["read", "Read"],
    ["failed", "Failed"],
  ];

  it.each(cases)("maps %s to %s", (state, label) => {
    expect(formatDeliveryStatus(state)).toBe(label);
  });

  it("maps delivered and read after receipts ship", () => {
    expect(formatDeliveryStatus("delivered")).toBe("Delivered");
    expect(formatDeliveryStatus("read")).toBe("Read");
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

  it("blocks new chats on standby unless the service ready predicate holds", () => {
    expect(isStandbyNewChatBlocked("standby", null)).toBe(true);
    expect(isStandbyNewChatBlocked("standby", "handshaking")).toBe(true);
    expect(isStandbyNewChatBlocked("standby", "established")).toBe(true);
    expect(isStandbyNewChatBlocked("standby", "established", { snapshot: "" })).toBe(true);
    expect(isStandbyNewChatBlocked("standby", "established", { snapshot: "HC1.opaque" })).toBe(false);
    expect(isStandbyNewChatBlocked("standby", "ready")).toBe(false);
    expect(isStandbyNewChatBlocked("standby", "handshaking", { linkReady: true })).toBe(false);
    expect(isStandbyNewChatBlocked("active", null)).toBe(false);
  });

  it("uses standby queued subtitle for initiator and responder roles", () => {
    expect(
      queuedThreadSubtitle({
        linkStatus: "handshaking-initiator",
        lastDeliveryState: "sending",
        receiverRole: "standby",
      }),
    ).toBe(QUEUED_STANDBY_SUBTITLE);
    expect(
      queuedThreadSubtitle({
        linkStatus: "handshaking-responder",
        lastDeliveryState: "sending",
        receiverRole: "standby",
      }),
    ).toBe(QUEUED_STANDBY_SUBTITLE);
    expect(queuedThreadSubtitle({ linkStatus: "error" })).toBe(CONNECTION_CHANGED_RETRY);
  });
});
