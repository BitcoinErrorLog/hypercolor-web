import { describe, expect, it } from "vitest";
import type { Contact } from "@/types";
import {
  followSuggestionContacts,
  relationshipBadges,
  rosterContacts,
  sortContactsForDisplay,
} from "./contacts-sort";

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

  it("keeps follow-only rows out of the roster", () => {
    const followOnly = contact({ pubky: "follow", isFollowing: true, addedManually: false });
    const added = contact({ pubky: "added", isFollowing: true, addedManually: true });
    const talked = contact({
      pubky: "talked",
      isFollowing: true,
      addedManually: false,
      lastInteractionAt: 9,
    });
    expect(rosterContacts([followOnly, added, talked]).map((row) => row.pubky).sort()).toEqual([
      "added",
      "talked",
    ]);
    expect(followSuggestionContacts([followOnly, added, talked]).map((row) => row.pubky)).toEqual([
      "follow",
    ]);
  });
});
