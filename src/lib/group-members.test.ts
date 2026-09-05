import { describe, expect, it } from "vitest";
import type { Contact } from "@/types";
import type { LinkRecord } from "@/types/link";
import { contactsWithEstablishedLinks } from "./group-members";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const OTHER = "q1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

function contact(pubky: string): Contact {
  return {
    pubky,
    ownerPubky: OWNER,
    trustScore: 0,
    isFollowing: false,
    isFollower: false,
    isMutual: false,
    addedManually: true,
    firstSeenAt: 1,
  };
}

function link(peerPubky: string, status: LinkRecord["status"]): LinkRecord {
  return {
    ownerPubky: OWNER,
    peerPubky,
    role: "initiator",
    status,
    snapshot: "x",
    remoteNoisePublicKey: "",
    localReceiverPath: "hypercolor/wallet",
    remoteReceiverPath: "hypercolor/wallet",
    consecutiveFailures: 0,
    lastSeenPeerMarkerPk: null,
    updatedAt: 1,
  };
}

describe("group-members", () => {
  it("only offers contacts that already have an established Encrypted Link", () => {
    const eligible = contactsWithEstablishedLinks(
      [contact(PEER), contact(OTHER)],
      [link(PEER, "established"), link(OTHER, "handshaking")],
    );
    expect(eligible.map((row) => row.pubky)).toEqual([PEER]);
  });
});
