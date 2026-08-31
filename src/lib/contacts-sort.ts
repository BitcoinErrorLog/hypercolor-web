import type { Contact } from "@/types";

export function contactRank(contact: Contact): number {
  if (contact.isMutual) return 3;
  if (contact.isFollowing) return 2;
  // isFollower is kept on the row for backup/restore. It is not knowable
  // from our homeserver, so it must not change rank or show a badge.
  return 0;
}

export function sortContactsForDisplay(contacts: readonly Contact[]): Contact[] {
  return [...contacts].sort((a, b) => {
    const rankDiff = contactRank(b) - contactRank(a);
    if (rankDiff !== 0) return rankDiff;
    return b.trustScore - a.trustScore;
  });
}

export function relationshipBadges(contact: Contact): string[] {
  const badges: string[] = [];
  if (contact.isMutual) badges.push("Mutual");
  else if (contact.isFollowing) badges.push("Following");
  if (contact.addedManually) badges.push("Added");
  return badges;
}

/**
 * Follow-derived rows are suggestions, not the roster.
 * A follow import never sets addedManually; talking to them sets lastInteractionAt.
 */
export function isFollowSuggestion(contact: Contact): boolean {
  return contact.isFollowing && !contact.addedManually && contact.lastInteractionAt == null;
}

export function rosterContacts(contacts: readonly Contact[]): Contact[] {
  return sortContactsForDisplay(contacts.filter((row) => !isFollowSuggestion(row)));
}

export function followSuggestionContacts(contacts: readonly Contact[]): Contact[] {
  return sortContactsForDisplay(contacts.filter(isFollowSuggestion));
}
