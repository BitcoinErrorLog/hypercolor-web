"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyPubkyButton } from "@/components/truncated-pubky";
import { DetailBackLink } from "@/components/detail-back";
import { ErrorDetails } from "@/components/error-details";
import { sanitizeDisplayName } from "@/lib/display-name";
import { shortPubky } from "@/lib/format";
import { collectGroupInvitations, type HeldGroupInvitation } from "@/lib/group-invites";
import { LinkService } from "@/services/link/LinkService";
import { StorageService } from "@/services/StorageService";
import { useAuthStore } from "@/stores/authStore";
import { threadRouteParams } from "@/types/link";
import type { Contact, MessageRequest } from "@/types";
import { emit } from "@/services/vibeware/collector";
import { emitCoarseError } from "@/services/vibeware/coarse";

type RequestRow = {
  request: MessageRequest;
  contact: Contact | null;
  invitations: HeldGroupInvitation[];
};

const EXPLAIN =
  "New inbound chats wait here until you accept. Nothing is auto-accepted — following someone does not open your inbox to them. Accepting opens the chat and any held group invitations. Declining drops the held items and remembers the decline.";

const INVITE =
  "Someone who has never messaged you cannot reach this queue yet — Hypercolor has no public drop point. Share your pubky and they can start the chat.";

function InviteBlock({ pubky }: { pubky: string | null }) {
  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4" data-testid="requestsInvite">
      <p className="text-sm text-muted-foreground">{INVITE}</p>
      {pubky ? (
        <div className="flex flex-wrap gap-2">
          <CopyPubkyButton pubky={pubky} />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (navigator.share) {
                void navigator.share({ text: pubky });
              } else {
                void navigator.clipboard.writeText(pubky);
              }
            }}
          >
            Share
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Connect with Pubky Ring to share your pubky.</p>
      )}
    </section>
  );
}

export function RequestsPage() {
  const router = useRouter();
  const ownerPubky = useAuthStore((s) => s.pubky);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [busyPeer, setBusyPeer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const emptyEmitted = useRef(false);

  const load = useCallback(async () => {
    if (!ownerPubky) {
      setRows([]);
      setLoaded(true);
      return;
    }
    const pending = await StorageService.listMessageRequests(ownerPubky, "pending");
    const next: RequestRow[] = [];
    for (const request of pending) {
      const [contact, streamItems] = await Promise.all([
        StorageService.getContact(request.peerPubky, ownerPubky),
        StorageService.getUnprocessedLinkStreamItems(ownerPubky, request.peerPubky),
      ]);
      next.push({
        request,
        contact,
        invitations: collectGroupInvitations(streamItems, request.peerPubky),
      });
    }
    setRows(next);
    setLoaded(true);
  }, [ownerPubky]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    if (!loaded) return;
    if (rows.length !== 0) return;
    if (emptyEmitted.current) return;
    emptyEmitted.current = true;
    void emit("app.chat.empty_state", { kind: "requests" });
  }, [loaded, rows.length]);

  return (
    <article className="space-y-6" data-testid="messageRequestsScreen" aria-busy={!loaded || undefined}>
      <DetailBackLink href="/chats" listLabel="Chats" always />
      <h1 className="text-2xl font-semibold tracking-tight">Message requests</h1>
      <p className="text-sm text-muted-foreground">{EXPLAIN}</p>
      {error ? <ErrorDetails fallback="Could not update this request." details={error} /> : null}
      {rows.length === 0 ? (
        <div className="space-y-4" data-testid="requestsEmpty">
          <p className="text-muted-foreground">No pending requests.</p>
          <p className="text-sm text-muted-foreground">
            New inbound chats wait here until you accept.
          </p>
          <InviteBlock pubky={ownerPubky} />
        </div>
      ) : (
        <>
          <InviteBlock pubky={ownerPubky} />
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const peer = row.request.peerPubky;
              const isContact = Boolean(row.contact?.addedManually || row.contact?.lastInteractionAt);
              const name = isContact && row.contact?.displayName
                ? sanitizeDisplayName(row.contact.displayName)
                : shortPubky(peer);
              const claimed =
                !isContact && row.contact?.displayName
                  ? `claims to be ${sanitizeDisplayName(row.contact.displayName)}`
                  : null;
              const busy = busyPeer === peer;
              return (
                <li key={peer} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{name}</p>
                    {claimed ? <p className="text-sm text-muted-foreground">{claimed}</p> : null}
                    <p className="break-all font-mono text-xs text-muted-foreground">{peer}</p>
                    {row.invitations.length > 0 ? (
                      <ul className="mt-2 space-y-1" data-testid="groupInvitation">
                        {row.invitations.map((invite) => (
                          <li key={invite.channelId} className="text-sm text-muted-foreground">
                            Group invitation
                            {invite.name ? ` · ${sanitizeDisplayName(invite.name)}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      data-testid="messageRequestAccept"
                      onClick={() => {
                        setBusyPeer(peer);
                        setError(null);
                        void LinkService.acceptMessageRequest(peer)
                          .then(async () => {
                            await load();
                            void emit("app.request.decision", {
                              kind: row.invitations.length > 0 ? "group-invite" : "dm",
                              decision: "accept",
                            });
                            const params = threadRouteParams(peer);
                            router.push(`/chats/${encodeURIComponent(params.threadId)}`);
                          })
                          .catch((err) => {
                            setError(err instanceof Error ? err.message : "Could not accept this request.");
                            emitCoarseError("requests", err);
                            return load();
                          })
                          .finally(() => setBusyPeer(null));
                      }}
                    >
                      Accept
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      data-testid="messageRequestDecline"
                      onClick={() => {
                        setBusyPeer(peer);
                        setError(null);
                        void LinkService.declineMessageRequest(peer)
                          .then(async () => {
                            await load();
                            void emit("app.request.decision", {
                              kind: row.invitations.length > 0 ? "group-invite" : "dm",
                              decision: "decline",
                            });
                          })
                          .catch((err) => {
                            setError(err instanceof Error ? err.message : "Could not decline this request.");
                            emitCoarseError("requests", err);
                            return load();
                          })
                          .finally(() => setBusyPeer(null));
                      }}
                    >
                      Decline
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </article>
  );
}
