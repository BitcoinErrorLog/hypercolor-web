"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { shortPubky } from "@/lib/format";
import { relationshipBadges } from "@/lib/contacts-sort";
import { formatTipIdentifierDisplay, payloadPreview } from "@/utils/displaySanitize";
import { StorageService } from "@/services/StorageService";
import { TrustEngine, type TrustExplanation } from "@/services/TrustEngine";
import { PaykitLinkWeb } from "@/services/link/PaykitLinkWeb";
import { LINK_RECEIVER_PATH } from "@/types/link";
import { buildDmConversationId } from "@/types/link";
import type { Contact } from "@/types";
import type { LinkRecord } from "@/types/link";

export function ContactDetail({
  ownerPubky,
  pubky,
}: {
  ownerPubky: string | null;
  pubky: string;
}) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [link, setLink] = useState<LinkRecord | null>(null);
  const [trust, setTrust] = useState<TrustExplanation | null>(null);
  const [methods, setMethods] = useState<string[]>([]);
  const [endpoints, setEndpoints] = useState<Record<string, string>>({});
  const [payError, setPayError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      try {
        const [ids, list] = await Promise.all([
          PaykitLinkWeb.listPaymentMethods(pubky, LINK_RECEIVER_PATH),
          PaykitLinkWeb.getPaymentList(pubky, LINK_RECEIVER_PATH),
        ]);
        if (cancelled) return;
        setMethods(ids);
        setEndpoints(list);
      } catch (err) {
        if (!cancelled) {
          setPayError(err instanceof Error ? err.message : "Could not read payment methods");
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerPubky, pubky]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading contact…</p>;
  }

  return (
    <article className="space-y-6" data-testid="contactDetail">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Contact</p>
        <h2 className="text-xl font-semibold">{contact?.displayName ?? shortPubky(pubky)}</h2>
        <p className="mt-1 break-all font-mono text-sm text-muted-foreground">{pubky}</p>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Relationship</h3>
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
        <h3 className="text-sm font-medium">Encrypted Link</h3>
        <p className="text-sm text-muted-foreground">
          {link
            ? `${link.status}${link.role ? ` · ${link.role}` : ""}`
            : "No Encrypted Link on this device yet. Sending a DM starts the handshake."}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Trust</h3>
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

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Public payment methods</h3>
        <p className="text-sm text-muted-foreground">
          Read-only from their Paykit receiver. This app does not send payments.
        </p>
        {payError ? <p className="text-sm text-red-400">{payError}</p> : null}
        {methods.length === 0 && Object.keys(endpoints).length === 0 ? (
          <p className="text-sm text-muted-foreground">No public methods published.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {Object.entries(endpoints).map(([id, payload]) => (
              <li key={id} className="rounded-md border border-border p-2">
                <p className="font-medium">{formatTipIdentifierDisplay(id)}</p>
                <p className="break-all text-muted-foreground">{payloadPreview(payload)}</p>
              </li>
            ))}
            {methods
              .filter((id) => !(id in endpoints))
              .map((id) => (
                <li key={id}>{formatTipIdentifierDisplay(id)}</li>
              ))}
          </ul>
        )}
      </section>

      <Button asChild>
        <Link href={`/chats/${encodeURIComponent(buildDmConversationId(pubky))}`}>Open chat</Link>
      </Button>
    </article>
  );
}
