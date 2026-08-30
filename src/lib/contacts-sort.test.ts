import { describe, expect, it } from "vitest";
import type { Contact } from "@/types";
import { relationshipBadges, sortContactsForDisplay } from "./contacts-sort";

function contact(partial: Partial<Contact> & Pick<Contact, "pubky">): Contact {
  return {
    ownerPubky: "owner",
    trustScore: 0,
    isFollowing: false,
    isFollower: false,
    isMutual: false,
    addedManually: false,
    firstSeenAt: 1,
    ...partial,
  };
}

describe("contacts-sort", () => {
  it("ranks mutual then following then followers", () => {
    const sorted = sortContactsForDisplay([
      contact({ pubky: "follower", isFollower: true, trustScore: 0.9 }),
      contact({ pubky: "mutual", isMutual: true, trustScore: 0.1 }),
      contact({ pubky: "following", isFollowing: true, trustScore: 0.2 }),
    ]);
    expect(sorted.map((row) => row.pubky)).toEqual(["mutual", "following", "follower"]);
  });

  it("labels relationship badges honestly", () => {
    expect(
      relationshipBadges(
        contact({ pubky: "x", isMutual: true, addedManually: true }),
      ),
    ).toEqual(["Mutual", "Added"]);
  });
});
