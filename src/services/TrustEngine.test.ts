import { beforeEach, describe, expect, it, vi } from "vitest";

const getContact = vi.fn();
const countLinkMessagesForPeer = vi.fn();
const upsertContact = vi.fn();

vi.mock("./StorageService", () => ({
  StorageService: {
    getContact: (...args: unknown[]) => getContact(...args),
    countLinkMessagesForPeer: (...args: unknown[]) => countLinkMessagesForPeer(...args),
    upsertContact: (...args: unknown[]) => upsertContact(...args),
  },
}));

import { TrustEngine } from "./TrustEngine";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

describe("TrustEngine social graph", () => {
  beforeEach(() => {
    getContact.mockReset();
    countLinkMessagesForPeer.mockReset();
    upsertContact.mockReset();
    countLinkMessagesForPeer.mockResolvedValue(0);
    upsertContact.mockResolvedValue(undefined);
  });

  it("does not raise score for isFollower-only rows", async () => {
    getContact.mockResolvedValue({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0,
      isFollowing: false,
      isFollower: true,
      isMutual: false,
      addedManually: false,
      firstSeenAt: 1,
    });
    const explanation = await TrustEngine.explain(PEER, OWNER);
    expect(explanation.score).toBe(0);
    expect(explanation.reasons).toEqual([]);
  });

  it("still scores a homeserver-confirmed follow", async () => {
    getContact.mockResolvedValue({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0,
      isFollowing: true,
      isFollower: false,
      isMutual: false,
      addedManually: false,
      firstSeenAt: 1,
    });
    const explanation = await TrustEngine.explain(PEER, OWNER);
    expect(explanation.score).toBe(0.15);
    expect(explanation.reasons).toEqual([
      { code: "following", contribution: 0.15, label: "You follow them" },
    ]);
  });
});
