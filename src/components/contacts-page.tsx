"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ContactDetail } from "@/components/contact-detail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePathSegment } from "@/hooks/usePathSegment";
import { relationshipBadges, sortContactsForDisplay } from "@/lib/contacts-sort";
import { shortPubky } from "@/lib/format";
import { addManualContact } from "@/services/contacts/addManualContact";
import { StorageService } from "@/services/StorageService";
import { useAuthStore } from "@/stores/authStore";
import { sanitizeDisplayName } from "@/lib/display-name";
import { useContactStore } from "@/stores/contactStore";
import type { Contact } from "@/types";

export function ContactsPage() {
  const router = useRouter();
  const selected = usePathSegment("contacts");
  const ownerPubky = useAuthStore((s) => s.pubky);
  const upsertContact = useContactStore((s) => s.upsertContact);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pending, setPending] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!ownerPubky) {
      setContacts([]);
      setPending(0);
      return;
    }
    const [rows, count] = await Promise.all([
      StorageService.getAllContacts(ownerPubky),
      StorageService.countPendingMessageRequests(ownerPubky),
    ]);
    rows.forEach(upsertContact);
    setContacts(sortContactsForDisplay(rows));
    setPending(count);
  }, [ownerPubky, upsertContact]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div
      className="grid min-h-[70vh] gap-6 md:grid-cols-[minmax(16rem,20rem)_1fr]"
      data-testid="contactsScreen"
    >
      <aside className={selected ? "hidden md:block" : undefined}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <Link
            href="/requests"
            className="text-sm text-brand underline-offset-4 hover:underline"
            data-testid="contactsRequests"
          >
            Requests{pending > 0 ? ` (${pending})` : ""}
          </Link>
        </div>

        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ownerPubky) {
              setError("Connect with Pubky Ring first.");
              return;
            }
            setBusy(true);
            setError(null);
            void addManualContact(ownerPubky, draft)
              .then((result) => {
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                upsertContact(result.contact);
                setDraft("");
                return reload().then(() => {
                  router.push(`/contacts/${encodeURIComponent(result.contact.pubky)}`);
                });
              })
              .finally(() => setBusy(false));
          }}
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste a pubky"
            data-testid="contactSearchInput"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <Button type="submit" size="sm" disabled={busy} data-testid="contactSearchAdd">
            {busy ? "Adding…" : "Add contact"}
          </Button>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </form>

        {contacts.length === 0 ? (
          <p className="mt-8 text-muted-foreground" data-testid="contactsEmpty">
            No contacts yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {contacts.map((contact) => (
              <li key={contact.pubky}>
                <Link
                  href={`/contacts/${encodeURIComponent(contact.pubky)}`}
                  data-testid="contactRow"
                  aria-label={contact.pubky}
                  className="block py-3 hover:bg-accent/40"
                >
                  <span className="font-medium">
                    {contact.displayName
                      ? sanitizeDisplayName(contact.displayName)
                      : shortPubky(contact.pubky)}
                  </span>
                  <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                    {contact.pubky}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {relationshipBadges(contact).map((badge) => (
                      <span key={badge} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                        {badge}
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className={!selected ? "hidden md:block" : undefined}>
        {selected ? (
          <ContactDetail ownerPubky={ownerPubky} pubky={selected} />
        ) : (
          <p className="text-sm text-muted-foreground">Select a contact.</p>
        )}
      </section>
    </div>
  );
}
