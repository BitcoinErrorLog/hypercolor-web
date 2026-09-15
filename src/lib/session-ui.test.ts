import { describe, expect, it } from "vitest";
import {
  hasIdentity,
  isMessagingEnabled,
  sessionPubky,
  sessionStatusLabel,
} from "./session-ui";

describe("session-ui", () => {
  it("treats no-identity as unsigned-in", () => {
    expect(hasIdentity({ kind: "no-identity" })).toBe(false);
    expect(isMessagingEnabled({ kind: "no-identity" })).toBe(false);
    expect(sessionPubky({ kind: "no-identity" })).toBeNull();
  });

  it("treats needs-enable as identity without a live receiver", () => {
    expect(hasIdentity({ kind: "needs-enable" })).toBe(true);
    expect(isMessagingEnabled({ kind: "needs-enable" })).toBe(false);
    expect(sessionStatusLabel({ kind: "needs-enable" })).toMatch(/enable messaging/i);
  });

  it("treats enabled as the live messaging state", () => {
    const status = { kind: "enabled" as const, pubky: "abc" };
    expect(isMessagingEnabled(status)).toBe(true);
    expect(sessionPubky(status)).toBe("abc");
    expect(sessionStatusLabel(status)).toMatch(/enabled/i);
  });
});
