"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DetailBackLink } from "@/components/detail-back";
import { TruncatedPubky } from "@/components/truncated-pubky";
import { DetailHeading } from "@/components/detail-heading";
import { sanitizeDisplayName } from "@/lib/display-name";
import { relationshipBadges } from "@/lib/contacts-sort";
import { StorageService } from "@/services/StorageService";
import { TrustEngine, type TrustExplanation } from "@/services/TrustEngine";
import { buildDmConversationId } from "@/types/link";
import { rememberThreadOrigin } from "@/lib/list-detail-focus";
import type { Contact } from "@/types";
import type { LinkRecord } from "@/types/link";

export function ContactDetail({
  ownerPubky,
  pubky,
}: {
  ownerPubky: string | null;
  pubky: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [link, setLink] = useState<LinkRecord | null>(null);
  const [trust, setTrust] = useState<TrustExplanation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    headingRef.current?.focus();
  }, [pubky]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!ownerPubky) {
        setLoading(false);
        return;
      }
      const [row, storedLink, explanation] = await Promise.all([
        StorageService.getContact(pubky, ownerPubky),
        StorageService.getLink(ownerPubky, pubky),
        TrustEngine.explain(pubky, ownerPubky),
      ]);
      if (cancelled) return;
      setContact(row);
      setLink(storedLink);
      setTrust(explanation);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerPubky, pubky]);

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" aria-busy="true">
        Loading contact…
      </p>
    );
  }

  return (
    <article className="space-y-6" data-testid="contactDetail">
      <DetailBackLink href="/contacts" listLabel="Contacts" />
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Contact</p>
        <DetailHeading headingRef={headingRef} className="text-xl font-semibold">
          {contact?.displayName ? sanitizeDisplayName(contact.displayName) : (
            <TruncatedPubky pubky={pubky} />
          )}
        </DetailHeading>
        <p className="mt-2 break-all font-mono text-sm text-muted-foreground">{pubky}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          aria-label="Copy full pubky"
          onClick={() => {
            void navigator.clipboard.writeText(pubky);
          }}
        >
          Copy
        </Button>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Relationship</h2>
        <div className="flex flex-wrap gap-2">
          {(contact ? relationshipBadges(contact) : []).map((badge) => (
            <span key={badge} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
              {badge}
            </span>
          ))}
          {!contact ? (
            <span className="text-sm text-muted-foreground">Not in your contacts yet.</span>
          ) : null}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Encrypted Link</h2>
        <p className="text-sm text-muted-foreground">
          {link
            ? `${link.status}${link.role ? ` · ${link.role}` : ""}`
            : "No Encrypted Link on this device yet. Sending a DM starts the handshake."}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Trust</h2>
        <p className="text-sm text-muted-foreground">
          Score {trust ? trust.score.toFixed(3) : "0"} — used only for sorting, never to block
          delivery.
        </p>
        {trust && trust.reasons.length > 0 ? (
          <ul className="text-sm text-muted-foreground">
            {trust.reasons.map((reason) => (
              <li key={reason.code}>
                {reason.label} ({reason.contribution})
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <Button asChild>
        <Link
          href={`/chats/${encodeURIComponent(buildDmConversationId(pubky))}`}
          onClick={() => rememberThreadOrigin({ kind: "contact", pubky })}
        >
          Message
        </Link>
      </Button>
    </article>
  );
}
