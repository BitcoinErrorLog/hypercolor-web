"use client";

import Link from "next/link";
import { useGuardedRouter } from "@/hooks/useBlockingGate";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChannelView, type ChannelViewFixture } from "@/components/channel-view";
import { PublicTopicsPanel } from "@/components/discover-page";
import { EnableMessagingCta } from "@/components/enable-messaging-cta";
import { ErrorDetails } from "@/components/error-details";
import { TagChannelView } from "@/components/tag-channel-view";
import { rememberAndOpen } from "@/components/detail-back";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, PageSubtitle } from "@/components/ui/page-header";
import { IllustratedEmptyState } from "@/components/ui/illustrated-empty-state";
import { IconHash } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { MasterDetail } from "@/components/shell/master-detail";
import { usePathSegment } from "@/hooks/usePathSegment";
import { useQueryParam } from "@/hooks/useQueryParam";
import { formatRelativeTime, shortPubky, unreadLabel } from "@/lib/format";
import type { InboxRow } from "@/lib/inbox";
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
import type { DiscoverTopicsView } from "./discover-topics";
import type { TagChannelFixture } from "./tag-channel-view";

export type ChannelsPageFixture = {
  mode: "private" | "public";
  pathId: string | null;
  ownerPubky: string | null;
  rows: InboxRow[];
  eligible: Contact[];
  name: string;
  selected: Record<string, boolean>;
  busy: boolean;
  error: string | null;
  loaded: boolean;
  loading: boolean;
  storeError: string | null;
  channelDetail?: ChannelViewFixture;
  channelMembersOpen?: boolean;
  publicTopics?: DiscoverTopicsView;
  tagDetail?: TagChannelFixture;
};

export function ChannelsPage({ fixture, now }: { fixture?: ChannelsPageFixture; now?: number } = {}) {
  const router = useGuardedRouter();
  const routePathId = usePathSegment("channels");
  const modeParam = useQueryParam("mode");
  const pathId = fixture?.pathId ?? routePathId;
  const mode = fixture?.mode ?? (modeParam === "public" ? "public" : "private");
  const channelId = mode === "private" ? pathId : null;
  const selectedTag = mode === "public" ? pathId : null;
  const storedOwnerPubky = useAuthStore((s) => s.pubky);
  const ownerPubky = fixture?.ownerPubky ?? storedOwnerPubky;
  const status = useSessionStatusStore((s) => s.status);
  const storedRows = useChannelsStore((s) => s.rows);
  const setRows = useChannelsStore((s) => s.setRows);
  const storedLoading = useChannelsStore((s) => s.loading);
  const setLoading = useChannelsStore((s) => s.setLoading);
  const storedStoreError = useChannelsStore((s) => s.error);
  const setStoreError = useChannelsStore((s) => s.setError);
  const [eligible, setEligible] = useState<Contact[]>(fixture?.eligible ?? []);
  const [name, setName] = useState(fixture?.name ?? "");
  const [selected, setSelected] = useState<Record<string, boolean>>(fixture?.selected ?? {});
  const [busy, setBusy] = useState(fixture?.busy ?? false);
  const [error, setError] = useState<string | null>(fixture?.error ?? null);
  const [loaded, setLoaded] = useState(fixture?.loaded ?? false);
  const emptyEmitted = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rows = fixture?.rows ?? storedRows;
  const loading = fixture?.loading ?? storedLoading;
  const storeError = fixture?.storeError ?? storedStoreError;

  const reload = useCallback(async () => {
    if (fixture) {
      setRows(fixture.rows);
      setEligible(fixture.eligible);
      setName(fixture.name);
      setSelected(fixture.selected);
      setBusy(fixture.busy);
      setError(fixture.error);
      setLoaded(fixture.loaded);
      setLoading(fixture.loading);
      setStoreError(fixture.storeError);
      return;
    }
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
  }, [ownerPubky, setRows, setLoading, setStoreError, fixture]);

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
    if (fixture) return;
    if (!ownerPubky) return;
    return subscribeGroupEvents((owner) => {
      if (owner === ownerPubky) void reload();
    });
  }, [ownerPubky, reload, fixture]);

  useEffect(() => {
    if (pathId) return;
    const rowId = takeListRow("channels");
    restoreListFocus(rowId, headingRef.current);
  }, [pathId, mode]);

  const selectedPubkys = Object.keys(selected).filter((key) => selected[key]);
  const detailOpen = Boolean(channelId || selectedTag);

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="channelsScreen"
      data-surface="channels-page"
    >
      <PageHeader className="shrink-0">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight">
          Channels
        </h1>
        <PageSubtitle>Public topics from the homeserver.</PageSubtitle>
      </PageHeader>
      <MasterDetail
        listClassName={detailOpen ? "hidden md:block" : undefined}
        detailClassName={!detailOpen ? "hidden md:flex" : undefined}
        list={
      <aside className="px-3 py-3" aria-busy={loading || undefined}>
        <div role="tablist" aria-label="Channel mode" className="mb-4 grid grid-cols-2 gap-1 rounded-full border border-border p-1">
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
          <PublicTopicsPanel selectedTag={selectedTag} fixture={fixture?.publicTopics} />
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
                <li><Skeleton className="h-14 w-full rounded-lg" /></li>
                <li><Skeleton className="h-14 w-full rounded-lg" /></li>
                <li><Skeleton className="h-14 w-full rounded-lg" /></li>
              </ul>
            ) : rows.length === 0 ? (
              <div className="mt-8 space-y-2" data-testid="channelsEmpty">
                <IllustratedEmptyState
                  icon={IconHash}
                  title="No private groups yet."
                  subtitle="A private group is end-to-end encrypted to every member, up to 50 people."
                />
              </div>
            ) : (
              <ul className="mt-4">
                {rows.map((row) => {
                  const rowId = channelRowDomId(row.id);
                  return (
                    <li key={row.id} className={channelId === row.id ? "hc-wash" : ""}>
                      <Link
                        id={rowId}
                        href={row.href}
                        data-testid="channelRow"
                        className="flex min-h-11 items-center gap-3 px-2 py-3 hover:bg-accent/40"
                        onClick={() => rememberAndOpen("channels", rowId)}
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full hc-brand-soft hc-brand-text">
                          <IconHash className="size-5" />
                        </div>
                        <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{sanitizeDisplayName(row.title)}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          Private group
                          {row.lastMessageAt ? ` · ${formatRelativeTime(row.lastMessageAt, now)}` : ""}
                        </span>
                        <span className="mt-1 flex items-center justify-between gap-2">
                          <span className="block truncate text-base text-muted-foreground">
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
        }
        detail={
        mode === "public" ? (
          <TagChannelView tag={selectedTag} fixture={fixture?.tagDetail} now={now} />
        ) : (
          <ChannelView channelId={channelId} fixture={fixture?.channelDetail} initialShowMembers={fixture?.channelMembersOpen} />
        )
        }
      />
    </div>
  );
}
