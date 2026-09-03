"use client";

import Link from "next/link";
import { useGuardedRouter } from "@/hooks/useBlockingGate";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChannelView } from "@/components/channel-view";
import { PublicTopicsPanel } from "@/components/discover-page";
import { EnableMessagingCta } from "@/components/enable-messaging-cta";
import { ErrorDetails } from "@/components/error-details";
import { TagChannelView } from "@/components/tag-channel-view";
import { rememberAndOpen } from "@/components/detail-back";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePathSegment } from "@/hooks/usePathSegment";
import { useQueryParam } from "@/hooks/useQueryParam";
import { formatRelativeTime, shortPubky, unreadLabel } from "@/lib/format";
import { PRIVATE_GROUP_MEMBER_CAP } from "@/flags/config";
import { GroupService, subscribeGroupEvents } from "@/services/group/GroupService";
import { StorageService } from "@/services/StorageService";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { loadChannelRows, useChannelsStore } from "@/stores/channelsStore";
import { contactsWithEstablishedLinks } from "@/lib/group-members";
import { channelRowDomId, restoreListFocus, takeListRow } from "@/lib/list-detail-focus";
import { sanitizeDisplayName } from "@/lib/display-name";
import { isMessagingEnabled } from "@/lib/session-ui";
import type { Contact } from "@/types";
import { GroupServiceError } from "@/types/group";
import { emit } from "@/services/vibeware/collector";
import { emitCoarseError } from "@/services/vibeware/coarse";

export function ChannelsPage() {
  const router = useGuardedRouter();
  const pathId = usePathSegment("channels");
  const modeParam = useQueryParam("mode");
  const mode = modeParam === "public" ? "public" : "private";
  const channelId = mode === "private" ? pathId : null;
  const selectedTag = mode === "public" ? pathId : null;
  const ownerPubky = useAuthStore((s) => s.pubky);
  const status = useSessionStatusStore((s) => s.status);
  const rows = useChannelsStore((s) => s.rows);
  const setRows = useChannelsStore((s) => s.setRows);
  const loading = useChannelsStore((s) => s.loading);
  const setLoading = useChannelsStore((s) => s.setLoading);
  const storeError = useChannelsStore((s) => s.error);
  const setStoreError = useChannelsStore((s) => s.setError);
  const [eligible, setEligible] = useState<Contact[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const emptyEmitted = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const reload = useCallback(async () => {
    if (!ownerPubky) {
      setRows([]);
      setEligible([]);
      setLoaded(true);
      setLoading(false);
      setStoreError(null);
      return;
    }
    setLoading(true);
    setStoreError(null);
    try {
      const [channelRows, people, links] = await Promise.all([
        loadChannelRows(ownerPubky),
        StorageService.getAllContacts(ownerPubky),
        StorageService.getAllLinks(ownerPubky),
      ]);
      setRows(channelRows);
      setEligible(contactsWithEstablishedLinks(people, links));
    } catch (err) {
      setStoreError(err instanceof Error ? err.message : "Could not load channels.");
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, [ownerPubky, setRows, setLoading, setStoreError]);

  useEffect(() => {
    void (async () => {
      await reload();
    })();
  }, [reload]);

  useEffect(() => {
    if (!loaded) return;
    if (rows.length !== 0) return;
    if (emptyEmitted.current) return;
    emptyEmitted.current = true;
    void emit("app.chat.empty_state", { kind: "groups" });
  }, [loaded, rows.length]);

  useEffect(() => {
    if (!ownerPubky) return;
    return subscribeGroupEvents((owner) => {
      if (owner === ownerPubky) void reload();
    });
  }, [ownerPubky, reload]);

  useEffect(() => {
    if (pathId) return;
    const rowId = takeListRow("channels");
    restoreListFocus(rowId, headingRef.current);
  }, [pathId, mode]);

  const selectedPubkys = Object.keys(selected).filter((key) => selected[key]);
  const detailOpen = Boolean(channelId || selectedTag);

  return (
    <div
      className="hc-master-detail"
      data-testid="channelsScreen"
    >
      <aside className={detailOpen ? "hidden md:block" : undefined} aria-busy={loading || undefined}>
        <div className="mb-4 flex items-center justify-between">
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight">
            Channels
          </h1>
        </div>
        <div role="tablist" aria-label="Channel mode" className="mb-4 grid grid-cols-2 gap-1 rounded-md border border-border p-1">
          <Link
            role="tab"
            aria-selected={mode === "private"}
            href="/channels"
            className={
              mode === "private"
                ? "inline-flex min-h-11 items-center justify-center rounded-sm bg-secondary text-sm font-semibold"
                : "inline-flex min-h-11 items-center justify-center rounded-sm text-sm text-muted-foreground"
            }
          >
            Private
          </Link>
          <Link
            role="tab"
            aria-selected={mode === "public"}
            href="/channels?mode=public"
            className={
              mode === "public"
                ? "inline-flex min-h-11 items-center justify-center rounded-sm bg-secondary text-sm font-semibold"
                : "inline-flex min-h-11 items-center justify-center rounded-sm text-sm text-muted-foreground"
            }
          >
            Public
          </Link>
        </div>
        <EnableMessagingCta testId="channelsEnableMessaging" />

        {mode === "public" ? (
          <PublicTopicsPanel selectedTag={selectedTag} />
        ) : (
          <>
            <form
              className="mt-4 space-y-3 rounded-md border border-border bg-card p-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!isMessagingEnabled(status)) {
                  setError("Enable encrypted messaging before creating a group.");
                  void emit("app.error.coarse", { code: "auth", surface: "channel" });
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
                    emitCoarseError("channel", err);
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <p className="text-sm font-medium">New private group</p>
              <p className="text-sm text-muted-foreground">
                A private group is end-to-end encrypted to every member, up to 50 people.
                Members must already have an established Encrypted Link with you.
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
                      <label className="flex min-h-11 items-center gap-2">
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
                            : shortPubky(contact.pubky)}
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
              {error ? <ErrorDetails fallback="Could not create group." details={error} /> : null}
            </form>

            {storeError ? (
              <div className="mt-3">
                <ErrorDetails
                  fallback="Could not load your channels."
                  details={storeError}
                  live="status"
                  onRetry={() => {
                    void reload();
                  }}
                />
              </div>
            ) : null}

            {loading && rows.length === 0 ? (
              <ul className="mt-4 space-y-2" data-testid="channelsLoading">
                <li className="h-11 animate-pulse rounded-md bg-secondary" />
                <li className="h-11 animate-pulse rounded-md bg-secondary" />
                <li className="h-11 animate-pulse rounded-md bg-secondary" />
              </ul>
            ) : rows.length === 0 ? (
              <div className="mt-8 space-y-2" data-testid="channelsEmpty">
                <p className="text-muted-foreground">No private groups yet.</p>
                <p className="text-sm text-muted-foreground">
                  A private group is end-to-end encrypted to every member, up to 50 people.
                </p>
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {rows.map((row) => {
                  const rowId = channelRowDomId(row.id);
                  return (
                    <li key={row.id}>
                      <Link
                        id={rowId}
                        href={row.href}
                        data-testid="channelRow"
                        className="block min-h-11 py-3 hover:bg-accent"
                        onClick={() => rememberAndOpen("channels", rowId)}
                      >
                        <span className="font-medium">{sanitizeDisplayName(row.title)}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          Private group
                          {row.lastMessageAt ? ` · ${formatRelativeTime(row.lastMessageAt)}` : ""}
                        </span>
                        <span className="mt-1 flex items-center justify-between gap-2">
                          <span className="block truncate text-sm text-muted-foreground">
                            {row.preview}
                          </span>
                          {row.unreadCount > 0 ? (
                            <span
                              className="rounded-full hc-brand-fill px-2 text-xs"
                              data-testid="channelUnread"
                            >
                              {unreadLabel(row.unreadCount)}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </aside>
      <section className={!detailOpen ? "hidden md:block" : undefined}>
        {mode === "public" ? (
          <TagChannelView tag={selectedTag} />
        ) : (
          <ChannelView channelId={channelId} />
        )}
      </section>
    </div>
  );
}
