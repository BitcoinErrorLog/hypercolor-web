import { describe, expect, it } from "vitest";
import { classifyInboundPeer } from "./wotGate";

describe("classifyInboundPeer", () => {
  const stranger = {
    isMutual: false,
    isFollowing: false,
    addedManually: false,
    hasEstablishedConversation: false,
  };

  it("requests a never-seen stranger", () => {
    expect(classifyInboundPeer(stranger)).toBe("request");
  });

  it("auto-accepts a follow, mutual, manual add, or prior conversation", () => {
    expect(classifyInboundPeer({ ...stranger, isFollowing: true })).toBe(
      "auto-accept",
    );
    expect(classifyInboundPeer({ ...stranger, isMutual: true })).toBe(
      "auto-accept",
    );
    expect(classifyInboundPeer({ ...stranger, addedManually: true })).toBe(
      "auto-accept",
    );
    expect(
      classifyInboundPeer({ ...stranger, hasEstablishedConversation: true }),
    ).toBe("auto-accept");
  });
});
