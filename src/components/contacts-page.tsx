"use client";

import Link from "next/link";
import { useGuardedRouter } from "@/hooks/useBlockingGate";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContactDetail } from "@/components/contact-detail";
import { FollowsImportPanel } from "@/components/follows-import-panel";
import { ErrorDetails } from "@/components/error-details";
import { rememberAndOpen } from "@/components/detail-back";
import { PubkyAnchors } from "@/components/pubky-anchors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconUsers } from "@/components/ui/icons";
import { IllustratedEmptyState } from "@/components/ui/illustrated-empty-state";
import { PageHeader, PageSubtitle } from "@/components/ui/page-header";
import { Avatar } from "@/components/ui/avatar";
import { MasterDetail } from "@/components/shell/master-detail";
import { usePathSegment } from "@/hooks/usePathSegment";
import {
  followSuggestionContacts,
  relationshipBadges,
  rosterContacts,
} from "@/lib/contacts-sort";
import { sanitizePublicBio, sanitizePublicName } from "@/lib/public-text";
import { shortPubky } from "@/lib/format";
import { contactRowDomId, restoreListFocus, takeListRow } from "@/lib/list-detail-focus";
import { ContactQrScanner, type ContactScannerFixture } from "@/components/contact-qr-scanner";
import { addManualContact } from "@/services/contacts/addManualContact";
import { parsePubkyPayload } from "@/lib/pubkyPayload";
import {
  isFollowsImportEnabled,
} from "@/services/contacts/followsImportPreference";
import { FollowsImporter } from "@/services/contacts/followsImport";
import { UsernameSearch } from "@/services/contacts/usernameSearch";
import type { UsernameSearchHit } from "@/services/contacts/usernameSearch";
import { StorageService } from "@/services/StorageService";
import { useAuthStore } from "@/stores/authStore";
import { sanitizeDisplayName } from "@/lib/display-name";
import { useContactStore } from "@/stores/contactStore";
import type { Contact } from "@/types";
import { emit } from "@/services/vibeware/collector";
import { emitCoarseError } from "@/services/vibeware/coarse";

const CONTACTS_FORM_ERROR = "Could not add or find this contact.";

export type ContactsPageFixture = {
  ownerPubky: string | null;
  selected: string | null;
  contacts: Contact[];
  draft: string;
  busy: boolean;
  searchBusy: boolean;
  error: string | null;
  hits: UsernameSearchHit[] | null;
  scanner?: ContactScannerFixture;
};

export function ContactsPage({ fixture }: { fixture?: ContactsPageFixture } = {}) {
  const router = useGuardedRouter();
  const routeSelected = usePathSegment("contacts");
  const selected = fixture?.selected ?? routeSelected;
  const storedOwnerPubky = useAuthStore((s) => s.pubky);
  const ownerPubky = fixture?.ownerPubky ?? storedOwnerPubky;
  const upsertContact = useContactStore((s) => s.upsertContact);
  const [contacts, setContacts] = useState<Contact[]>(fixture?.contacts ?? []);
  const [draft, setDraft] = useState(fixture?.draft ?? "");
  const [busy, setBusy] = useState(fixture?.busy ?? false);
  const [searchBusy, setSearchBusy] = useState(fixture?.searchBusy ?? false);
  const [error, setError] = useState<string | null>(fixture?.error ?? null);
  const [hits, setHits] = useState<UsernameSearchHit[] | null>(fixture?.hits ?? null);
  const [scannerOpen, setScannerOpen] = useState(Boolean(fixture?.scanner));

  const reload = useCallback(async () => {
    if (fixture) {
      setContacts(fixture.contacts);
      setDraft(fixture.draft);
      setBusy(fixture.busy);
      setSearchBusy(fixture.searchBusy);
      setError(fixture.error);
      setHits(fixture.hits);
      return;
    }
    if (!ownerPubky) {
      setContacts([]);
      return;
    }
    const rows = await StorageService.getAllContacts(ownerPubky);
    rows.forEach(upsertContact);
    setContacts(rows);
  }, [ownerPubky, upsertContact, fixture]);

  useEffect(() => {
    if (fixture) return;
    void (async () => {
      await reload();
      if (ownerPubky && isFollowsImportEnabled(ownerPubky)) {
        const result = await FollowsImporter.importFollows(ownerPubky);
        if (result.ok && !result.skipped) await reload();
      }
    })();
  }, [reload, ownerPubky, fixture]);

  const roster = rosterContacts(contacts);
  const suggestions = followSuggestionContacts(contacts);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (selected) return;
    const rowId = takeListRow("contacts");
    restoreListFocus(rowId, headingRef.current);
  }, [selected]);

  async function addPeer(raw: string, displayName?: string): Promise<void> {
    if (!ownerPubky) {
      setError("Connect with Pubky Ring first.");
      void emit("app.error.coarse", { code: "auth", surface: "contacts" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await addManualContact(
        ownerPubky,
        raw,
        displayName ? { displayName } : {},
      );
      if (!result.ok) {
        setError(result.message);
        void emit("app.error.coarse", { code: "validation", surface: "contacts" });
        return;
      }
      upsertContact(result.contact);
      setDraft("");
      setHits(null);
      await reload();
      router.push(`/contacts/${encodeURIComponent(result.contact.pubky)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : CONTACTS_FORM_ERROR);
      emitCoarseError("contacts", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      data-testid="contactsScreen"
      data-surface="contacts-page"
    >
      <PageHeader className="shrink-0">
        <h1
          ref={headingRef}
          tabIndex={-1}
          id="contactsHeading"
          className="text-2xl font-bold tracking-tight outline-none focus:outline-none focus-visible:outline-none hc-programmatic-focus"
        >
          Contacts
        </h1>
        <PageSubtitle>People you have an encrypted link with.</PageSubtitle>
      </PageHeader>
      <MasterDetail
        listClassName={selected ? "hidden md:block" : undefined}
        detailClassName={!selected ? "hidden md:flex" : undefined}
        list={
      <aside className="px-3 py-3">

        <FollowsImportPanel key={ownerPubky ?? "none"} ownerPubky={ownerPubky} onImported={reload} />

        <form
          className="mt-4 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const asPubky = parsePubkyPayload(draft);
            if (asPubky) {
              void addPeer(draft);
              return;
            }
            setSearchBusy(true);
            setError(null);
            setHits(null);
            void UsernameSearch.search(draft)
              .then((result) => {
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                if (result.kind === "pubky") {
                  void addPeer(result.pubky);
                  return;
                }
                setHits(result.hits);
                if (result.hits.length === 0) {
                  setError("No usernames matched. A username is not an identity — paste the pubky.");
                }
              })
              .catch((err) => {
                setError(err instanceof Error ? err.message : CONTACTS_FORM_ERROR);
                emitCoarseError("contacts", err);
              })
              .finally(() => setSearchBusy(false));
          }}
        >
          <Input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setHits(null);
            }}
            placeholder="Paste a pubky or search a username"
            data-testid="contactSearchInput"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <p className="text-xs text-muted-foreground" data-testid="contactSearchIdentityCopy">
            A username is not an identity. The pubky is. Lookalike names are common, and this
            page cannot catch every trick — no warning is not an assurance. Compare the full
            key before adding. Searching asks the public index for this prefix; skip search
            and paste a pubky if you do not want that query. Adding by pubky does not ask the index.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="contactsScanQr"
              onClick={() => setScannerOpen(true)}
            >
              Scan QR
            </Button>
            {parsePubkyPayload(draft) ? (
              <Button type="submit" size="sm" disabled={busy} data-testid="contactSearchAdd">
                {busy ? "Adding…" : "Add contact"}
              </Button>
            ) : (
              <>
                <Button
                  type="submit"
                  size="sm"
                  disabled={searchBusy}
                  data-testid="contactSearchLookup"
                >
                  {searchBusy ? "Searching…" : "Search username"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  data-testid="contactSearchAdd"
                  onClick={() => void addPeer(draft)}
                >
                  {busy ? "Adding…" : "Add by pubky"}
                </Button>
              </>
            )}
          </div>
          {error ? (
            <ErrorDetails
              fallback={CONTACTS_FORM_ERROR}
              details={error}
              onTakeOver={() => {
                void import("@/services/tabLock").then((m) => m.requestTakeover());
              }}
              repairHref="/settings#repair-local-data"
            />
          ) : null}
        </form>
        <ContactQrScanner
          key={scannerOpen ? "open" : "closed"}
          open={scannerOpen}
          fixture={fixture?.scanner}
          onClose={() => setScannerOpen(false)}
          onDecoded={(raw) => {
            setScannerOpen(false);
            void addPeer(raw);
          }}
        />

        {hits && hits.length > 0 ? (
          <ul className="mt-3 divide-y divide-border rounded-md border border-border" data-testid="contactSearchResults">
            {hits.map((hit) => (
              <li key={hit.pubky} className="space-y-1 p-3" data-testid="contactSearchResult">
                <p className="font-medium">
                  {hit.name ? sanitizePublicName(hit.name) : shortPubky(hit.pubky)}
                </p>
                <PubkyAnchors pubky={hit.pubky} />
                {hit.lookalike ? (
                  <p className="text-xs hc-warning-text" data-testid="contactSearchLookalike">
                    This name mixes character sets that can look alike. The check is incomplete — compare the full pubky.
                  </p>
                ) : null}
                {hit.bio ? (
                  <p className="text-xs text-muted-foreground">{sanitizePublicBio(hit.bio)}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Name is a label. This pubky is the identity.
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => void addPeer(hit.pubky, hit.name ?? undefined)}
                >
                  Add this pubky
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {suggestions.length > 0 ? (
          <div className="mt-6" data-testid="followSuggestions">
            <p className="text-sm font-medium">Suggestions from your follows</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Not your contact list. Add one to keep them. Hypercolor never writes a follow.
            </p>
            <ul className="mt-2 divide-y divide-border">
              {suggestions.map((contact) => (
                <li key={contact.pubky} className="py-3" data-testid="followSuggestion">
                  <p className="font-medium">
                    {contact.displayName
                      ? sanitizeDisplayName(contact.displayName)
                      : shortPubky(contact.pubky)}
                  </p>
                  <PubkyAnchors pubky={contact.pubky} />
                  <Button
                    type="button"
                    size="sm"
                    className="mt-2"
                    disabled={busy}
                    onClick={() => void addPeer(contact.pubky)}
                  >
                    Add as contact
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {roster.length === 0 ? (
          <div className="mt-8 space-y-2" data-testid="contactsEmpty">
            <IllustratedEmptyState
              icon={IconUsers}
              title="No contacts yet."
              subtitle="Add someone by pubky, or use your public pubky.app follows to recognise people you already know."
            />
          </div>
        ) : (
          <ul className="mt-4">
            {roster.map((contact) => (
              <li
                key={contact.pubky}
                className={selected === contact.pubky ? "rounded-lg hc-wash px-2" : "px-2"}
              >
                <Link
                  id={contactRowDomId(contact.pubky)}
                  href={`/contacts/${encodeURIComponent(contact.pubky)}`}
                  data-testid="contactRow"
                  aria-label={`Open contact ${
                    contact.displayName
                      ? sanitizeDisplayName(contact.displayName)
                      : shortPubky(contact.pubky)
                  }`}
                  className="flex min-h-11 items-center gap-2 py-2 hover:bg-accent/40"
                  onClick={() => rememberAndOpen("contacts", contactRowDomId(contact.pubky))}
                >
                  <Avatar seed={contact.pubky} size="md" />
                  <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">
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
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>
        }
        detail={
        selected ? (
          <ContactDetail ownerPubky={ownerPubky} pubky={selected} />
        ) : (
          <p className="flex h-full min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">Select a contact.</p>
        )
        }
      />
    </div>
  );
}
