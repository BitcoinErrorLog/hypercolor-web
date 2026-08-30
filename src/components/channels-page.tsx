"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChannelView } from "@/components/channel-view";
import { EnableMessagingCta } from "@/components/enable-messaging-cta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePathSegment } from "@/hooks/usePathSegment";
import { formatRelativeTime } from "@/lib/format";
import { PRIVATE_GROUP_MEMBER_CAP } from "@/flags/config";
import { GroupService, subscribeGroupEvents } from "@/services/group/GroupService";
import { StorageService } from "@/services/StorageService";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { contactsWithEstablishedLinks } from "@/lib/group-members";
import { excludeHeldFounderChannels, heldGroupFounderSet } from "@/lib/group-invites";
import { sanitizeDisplayName } from "@/lib/display-name";
import { isMessagingEnabled } from "@/lib/session-ui";
import type { Contact } from "@/types";
import type { GroupChannel } from "@/types/group";
import { GroupServiceError } from "@/types/group";

export function ChannelsPage() {
  const router = useRouter();
  const channelId = usePathSegment("channels");
  const ownerPubky = useAuthStore((s) => s.pubky);
  const status = useSessionStatusStore((s) => s.status);
  const [channels, setChannels] = useState<GroupChannel[]>([]);
  const [eligible, setEligible] = useState<Contact[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!ownerPubky) {
      setChannels([]);
      setEligible([]);
      return;
    }
    const [rows, people, links, requests] = await Promise.all([
      GroupService.listChannels(),
      StorageService.getAllContacts(ownerPubky),
      StorageService.getAllLinks(ownerPubky),
      StorageService.listMessageRequests(ownerPubky),
    ]);
    setChannels(excludeHeldFounderChannels(rows, heldGroupFounderSet(requests)));
    setEligible(contactsWithEstablishedLinks(people, links));
  }, [ownerPubky]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!ownerPubky) return;
    return subscribeGroupEvents((owner) => {
      if (owner === ownerPubky) void reload();
    });
  }, [ownerPubky, reload]);

  const selectedPubkys = Object.keys(selected).filter((key) => selected[key]);

  return (
    <div
      className="grid min-h-[70vh] gap-6 md:grid-cols-[minmax(16rem,20rem)_1fr]"
      data-testid="channelsScreen"
    >
      <aside className={channelId ? "hidden md:block" : undefined}>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
        </div>
        <EnableMessagingCta testId="channelsEnableMessaging" />

        <form
          className="mt-4 space-y-3 rounded-md border border-border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isMessagingEnabled(status)) {
              setError("Enable encrypted messaging before creating a group.");
              return;
            }
            setBusy(true);
            setError(null);
            void GroupService.createChannel(name, selectedPubkys)
              .then((created) => {
                setName("");
                setSelected({});
                return reload().then(() => {
                  router.push(`/channels/${encodeURIComponent(created.channelId)}`);
                });
              })
              .catch((err) => {
                setError(
                  err instanceof GroupServiceError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : "Could not create group",
                );
              })
              .finally(() => setBusy(false));
          }}
        >
          <p className="text-sm font-medium">New private group</p>
          <p className="text-sm text-muted-foreground">
            Members must already have an established Encrypted Link with you. Public
            channels are not available on web.
          </p>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Group name"
            data-testid="channelCreateName"
          />
          {eligible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No linked contacts yet. Start a DM and complete a handshake first.
            </p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {eligible.map((contact) => (
                <li key={contact.pubky}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(selected[contact.pubky])}
                      disabled={
                        !selected[contact.pubky] &&
                        selectedPubkys.length + 1 >= PRIVATE_GROUP_MEMBER_CAP
                      }
                      onChange={(event) =>
                        setSelected((prev) => ({
                          ...prev,
                          [contact.pubky]: event.target.checked,
                        }))
                      }
                    />
                    <span className="truncate">
                      {contact.displayName
                        ? sanitizeDisplayName(contact.displayName)
                        : contact.pubky}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={busy || name.trim().length === 0}
            data-testid="channelCreate"
          >
            {busy ? "Creating…" : "Create group"}
          </Button>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </form>

        {channels.length === 0 ? (
          <p className="mt-8 text-muted-foreground" data-testid="channelsEmpty">
            No channels yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {channels.map((row) => (
              <li key={row.channelId}>
                <Link
                  href={`/channels/${encodeURIComponent(row.channelId)}`}
                  data-testid="channelRow"
                  className="block py-3 hover:bg-accent/40"
                >
                  <span className="font-medium">{sanitizeDisplayName(row.name)}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {row.lastMessageAt ? formatRelativeTime(row.lastMessageAt) : "No messages yet"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className={!channelId ? "hidden md:block" : undefined}>
        <ChannelView channelId={channelId} />
      </section>
    </div>
  );
}
