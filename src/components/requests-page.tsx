"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { shortPubky } from "@/lib/format";
import { LinkService } from "@/services/link/LinkService";
import { StorageService } from "@/services/StorageService";
import { useAuthStore } from "@/stores/authStore";
import { threadRouteParams } from "@/types/link";
import type { Contact, MessageRequest } from "@/types";

type RequestRow = {
  request: MessageRequest;
  contact: Contact | null;
};

export function RequestsPage() {
  const router = useRouter();
  const ownerPubky = useAuthStore((s) => s.pubky);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [busyPeer, setBusyPeer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ownerPubky) {
      setRows([]);
      return;
    }
    const pending = await StorageService.listMessageRequests(ownerPubky, "pending");
    const next: RequestRow[] = [];
    for (const request of pending) {
      const contact = await StorageService.getContact(request.peerPubky, ownerPubky);
      next.push({ request, contact });
    }
    setRows(next);
  }, [ownerPubky]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <article className="space-y-6" data-testid="messageRequestsScreen">
      <h1 className="text-2xl font-semibold tracking-tight">Message requests</h1>
      <p className="text-sm text-muted-foreground">
        Inbound links from people you do not follow wait here. Accepting opens the
        conversation; declining drops held stream items and remembers the decline.
      </p>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {rows.length === 0 ? (
        <div className="space-y-2" data-testid="requestsEmpty">
          <p className="text-muted-foreground">No pending requests.</p>
          <p className="text-sm text-muted-foreground">
            Inbound links from people you do not follow wait here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const peer = row.request.peerPubky;
            const name = row.contact?.displayName ?? shortPubky(peer);
            const busy = busyPeer === peer;
            return (
              <li key={peer} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{name}</p>
                  <p className="break-all font-mono text-xs text-muted-foreground">{peer}</p>
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
                          const params = threadRouteParams(peer);
                          router.push(`/chats/${encodeURIComponent(params.threadId)}`);
                        })
                        .catch((err) => {
                          setError(err instanceof Error ? err.message : "Accept failed");
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
                        .then(() => load())
                        .catch((err) => {
                          setError(err instanceof Error ? err.message : "Decline failed");
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
