import { describe, expect, it } from "vitest";
import {
  PUBLIC_GRAPH_WARNING,
  PUBLIC_SUBSTRATE_LINE,
  CUSTODY_LINE,
  hasIdentity,
  isMessagingEnabled,
  OFFLINE_BANNER_LABEL,
  sessionCopy,
  sessionCtaLabel,
  sessionPubky,
  sessionStatusLabel,
} from "./session-ui";

describe("session-ui", () => {
  it("treats no-identity as unsigned-in", () => {
    expect(hasIdentity({ kind: "no-identity" })).toBe(false);
    expect(isMessagingEnabled({ kind: "no-identity" })).toBe(false);
    expect(sessionPubky({ kind: "no-identity" })).toBeNull();
    expect(sessionStatusLabel({ kind: "no-identity" })).toBe("Not connected");
    expect(sessionCtaLabel({ kind: "no-identity" })).toBe("Connect with Pubky Ring");
    expect(sessionCopy({ kind: "no-identity" }).body).toBe(CUSTODY_LINE);
  });

  it("treats needs-enable as identity without a live receiver", () => {
    expect(hasIdentity({ kind: "needs-enable" })).toBe(true);
    expect(isMessagingEnabled({ kind: "needs-enable" })).toBe(false);
    expect(sessionStatusLabel({ kind: "needs-enable" })).toBe("Messaging not enabled");
    expect(sessionCopy({ kind: "needs-enable" }).primaryHref).toBe("/enable");
    expect(sessionCopy({ kind: "needs-enable" }).primaryAction).toBe("navigate");
  });

  it("maps live (grant without receiver) onto the needs-enable copy", () => {
    const status = { kind: "live" as const, pubky: "abc" };
    expect(sessionStatusLabel(status)).toBe("Messaging not enabled");
    expect(sessionCtaLabel(status)).toBe("Enable encrypted messaging");
  });

  it("treats enabled as the live messaging state", () => {
    const status = { kind: "enabled" as const, pubky: "abc" };
    expect(isMessagingEnabled(status)).toBe(true);
    expect(sessionPubky(status)).toBe("abc");
    expect(sessionStatusLabel(status)).toBe("Encrypted messaging enabled");
  });

  it("uses Try again as an in-place retry for session-offline, not /enable", () => {
    const status = { kind: "session-offline" as const, pubky: "abc" };
    const copy = sessionCopy(status);
    expect(copy.label).toBe(OFFLINE_BANNER_LABEL);
    expect(copy.primary).toBe("Try again");
    expect(copy.primaryAction).toBe("retry");
    expect(copy.primaryHref).toBeNull();
  });

  it("keeps unknown as a loading label, not a banner state", () => {
    expect(sessionStatusLabel({ kind: "unknown" })).toBe("Checking session…");
    expect(sessionCopy({ kind: "unknown" }).primaryAction).toBe("none");
  });

  it("ships canonical public-graph warning copy", () => {
    expect(PUBLIC_GRAPH_WARNING).toContain("world-readable and permanent");
    expect(PUBLIC_SUBSTRATE_LINE).toContain("public Pubky graph");
    expect(CUSTODY_LINE).toBe("Pubky Ring holds your key. Hypercolor never sees it.");
  });
});
