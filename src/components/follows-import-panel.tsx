"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FollowsImporter } from "@/services/contacts/followsImport";
import {
  isFollowsImportEnabled,
  setFollowsImportEnabled,
} from "@/services/contacts/followsImportPreference";

export function FollowsImportPanel({
  ownerPubky,
  onImported,
}: {
  ownerPubky: string | null;
  onImported: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(() =>
    ownerPubky ? isFollowsImportEnabled(ownerPubky) : false,
  );
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const importGeneration = useRef(0);

  useEffect(() => {
    return () => {
      importGeneration.current += 1;
    };
  }, []);

  if (!ownerPubky) return null;

  return (
    <section
      className="mt-4 space-y-3 rounded-md border border-border bg-card p-4"
      data-testid="followsImportPanel"
    >
      <p className="text-sm font-medium">pubky.app follows</p>
      <p className="text-sm text-muted-foreground" data-testid="followsImportCopy">
        Follows at <span className="font-mono">/pub/pubky.app/follows/</span> are already
        world-readable. Importing them does not publish a new list — Hypercolor only reads
        what anyone can already see. Acting on a suggestion (adding them, or messaging them)
        may tell others you use this messenger. This is not your contact list. People who
        follow you, but whom you do not follow, are not added. Hypercolor will not write a
        follow. Inbound chats from people you follow may be accepted automatically. While
        this is on, opening Contacts re-reads that homeserver listing. The public index
        (Nexus) is asked for your following list only if the homeserver listing is
        unavailable; each Nexus name is then re-checked against your homeserver. Hypercolor
        does not ask Nexus who follows you. Stopping import clears follow recognition so it
        cannot keep auto-accepting.
      </p>
      {enabled ? (
        <div className="space-y-2">
          <p className="text-sm" data-testid="followsImportStatus">
            Follows import is on. Suggestions stay separate from contacts you added.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              data-testid="followsImportRefresh"
              onClick={() => {
                const generation = importGeneration.current;
                setBusy(true);
                setNote(null);
                void FollowsImporter.importFollows(ownerPubky)
                  .then((result) => {
                    if (generation !== importGeneration.current) return;
                    if (!result.ok) {
                      setNote(result.message);
                      return;
                    }
                    if (result.skipped) return;
                    setNote(
                      result.source === "homeserver"
                        ? `Read ${result.confirmedCount} follows from your homeserver.`
                        : `Confirmed ${result.confirmedCount} follows against your homeserver after the public index listed candidates.`,
                    );
                    return onImported();
                  })
                  .finally(() => {
                    if (generation === importGeneration.current) setBusy(false);
                  });
              }}
            >
              {busy ? "Reading…" : "Refresh follows"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              data-testid="followsImportDisable"
              onClick={() => {
                const generation = ++importGeneration.current;
                setFollowsImportEnabled(ownerPubky, false);
                setEnabled(false);
                setUnderstood(false);
                setBusy(true);
                setNote(null);
                void FollowsImporter.clearImportedRelationshipFlags(ownerPubky)
                  .then(() => {
                    if (generation !== importGeneration.current) return;
                    setNote(
                      "Import is off. Follow recognition was cleared. Inbound chats from those follows need an explicit accept unless you added them or already have a conversation.",
                    );
                    return onImported();
                  })
                  .finally(() => {
                    if (generation === importGeneration.current) setBusy(false);
                  });
              }}
            >
              Stop using follows
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={understood}
              onChange={(event) => setUnderstood(event.target.checked)}
              data-testid="followsImportUnderstand"
            />
            I understand follows are public, that import does not hide them, and that
            messaging someone may reveal I use Hypercolor.
          </label>
          <Button
            type="button"
            size="sm"
            disabled={!understood || busy}
            data-testid="followsImportEnable"
            onClick={() => {
              const generation = importGeneration.current;
              setBusy(true);
              setNote(null);
              setFollowsImportEnabled(ownerPubky, true);
              setEnabled(true);
              void FollowsImporter.importFollows(ownerPubky)
                .then((result) => {
                  if (generation !== importGeneration.current) return;
                  if (!result.ok) {
                    setNote(result.message);
                    return;
                  }
                  if (result.skipped) return;
                  setNote(
                    result.confirmedCount === 0
                      ? "No confirmed follows yet."
                      : `Imported ${result.confirmedCount} confirmed follows as suggestions.`,
                  );
                  return onImported();
                })
                .finally(() => {
                  if (generation === importGeneration.current) setBusy(false);
                });
            }}
          >
            {busy ? "Reading…" : "Use my pubky.app follows to recognise people"}
          </Button>
        </div>
      )}
      {note ? (
        <p className="text-sm text-muted-foreground" data-testid="followsImportNote">
          {note}
        </p>
      ) : null}
    </section>
  );
}
