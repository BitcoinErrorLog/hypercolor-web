import type { Contact, PubkyKey } from "@/types";
import type { LinkRecord } from "@/types/link";

export function establishedPeerSet(links: readonly LinkRecord[]): Set<PubkyKey> {
  return new Set(
    links.filter((link) => link.status === "established").map((link) => link.peerPubky),
  );
}

export function contactsWithEstablishedLinks(
  contacts: readonly Contact[],
  links: readonly LinkRecord[],
): Contact[] {
  const linked = establishedPeerSet(links);
  return contacts.filter((contact) => linked.has(contact.pubky));
}
