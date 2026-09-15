"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
    <article className="space-y-6" data-testid="messageRequestsScreen">
      <h1 className="text-2xl font-semibold tracking-tight">Message requests</h1>
      <p className="text-sm text-muted-foreground">
        New inbound conversations wait here until you accept. Follows do not
        open a chat. Accepting opens the conversation and any held group
        invitations; declining drops held stream items and remembers the
        decline. Group invitations show a name only.
      </p>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {rows.length === 0 ? (
        <div className="space-y-2" data-testid="requestsEmpty">
          <p className="text-muted-foreground">No pending requests.</p>
          <p className="text-sm text-muted-foreground">
            New inbound conversations wait here until you accept.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const peer = row.request.peerPubky;
            const name = row.contact?.displayName
              ? sanitizeDisplayName(row.contact.displayName)
              : shortPubky(peer);
            const busy = busyPeer === peer;
            return (
              <li key={peer} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{name}</p>
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
                          setError(err instanceof Error ? err.message : "Accept failed");
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
                          setError(err instanceof Error ? err.message : "Decline failed");
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
      )}
    </article>
  );
}
