"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IllustratedEmptyState } from "@/components/ui/illustrated-empty-state";
import { IconMessageCircle } from "@/components/ui/icons";
import { PageHeader, PageSubtitle } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/ui/avatar";
import { MasterDetail } from "@/components/shell/master-detail";
import { ErrorDetails } from "@/components/error-details";
import { isReadOnlyTabError } from "@/db/errors";
import { rememberAndOpen } from "@/components/detail-back";
import { contactPrimaryLabel } from "@/lib/contact-label";
import { formatRelativeTime, unreadLabel } from "@/lib/format";
import { chatRowDomId, rememberThreadOrigin, restoreListFocus, takeListRow } from "@/lib/list-detail-focus";
import { canComposeMessages } from "@/lib/session-ui";
import type { SessionUiStatus } from "@/stores/sessionStatusStore";

export type ChatsPageRow = {
  key: string;
  href: string;
  title: string;
  kind: "dm";
  preview: string;
  lastMessageAt: number;
  unreadCount: number;
  nickname?: string | null;
  displayName?: string | null;
  pubky?: string;
  muted?: boolean;
  archived?: boolean;
  linkStatus?: string | null;
};

export const CHATS_EMPTY_STATE_CONTROL_HINT =
  "Start a new chat from the field above.";
export const CHATS_EMPTY_STATE_BODY =
  "Add someone by pubky, then start a chat. Nobody can message you first until you have talked before or you invite them.";
export const CHATS_EMPTY_STATE_CANDIDATE_HINT = "Try the search field above to start a chat.";

export function ChatsPage({
  conversationId,
  enableCta,
  thread,
  rows,
  pendingRequests,
  inboxError,
  inboxLoading,
  onRetryInbox,
  peerDraft,
  starting,
  startError,
  status,
  onChangePeerDraft,
  onStartChat,
  emptyStateHint = CHATS_EMPTY_STATE_BODY,
  now,
  listFilter = "inbox",
  onChangeListFilter,
  searchQuery = "",
  searchHits,
  onChangeSearchQuery,
}: {
  conversationId: string | null;
  enableCta: ReactNode;
  thread: ReactNode;
  rows: ChatsPageRow[];
  pendingRequests: number;
  inboxError: string | null;
  inboxLoading?: boolean;
  onRetryInbox?: () => void;
  peerDraft: string;
  starting: boolean;
  startError: string | null;
  status: SessionUiStatus;
  onChangePeerDraft: (value: string) => void;
  onStartChat: () => void;
  emptyStateHint?: string;
  now?: number;
  listFilter?: "inbox" | "archived" | "muted";
  onChangeListFilter?: (filter: "inbox" | "archived" | "muted") => void;
  searchQuery?: string;
  searchHits?: { threadKey: string; eventId: string; snippet: string }[];
  onChangeSearchQuery?: (value: string) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const composeEnabled = canComposeMessages(status);

  useEffect(() => {
    if (conversationId) return;
    const rowId = takeListRow("chats");
    restoreListFocus(rowId, headingRef.current);
  }, [conversationId]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="chatsScreen" data-surface="chats-page">
      <PageHeader className="shrink-0">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-bold tracking-tight outline-none focus:outline-none focus-visible:outline-none hc-programmatic-focus"
        >
          Chats
        </h1>
        <PageSubtitle>Encrypted threads on this device.</PageSubtitle>
        <form
          className="mt-3"
          onSubmit={(event) => event.preventDefault()}
        >
          <Input
            value={searchQuery}
            onChange={(event) => onChangeSearchQuery?.(event.target.value)}
            placeholder="Search messages"
            data-testid="chatsSearch"
            aria-label="Search messages"
          />
        </form>
        {searchHits && searchHits.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm" data-testid="chatsSearchHits">
            {searchHits.map((hit) => (
              <li key={`${hit.threadKey}:${hit.eventId}`} className="truncate text-muted-foreground">
                {hit.snippet}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 flex gap-2" role="tablist" aria-label="Chat filters">
          {(["inbox", "archived", "muted"] as const).map((filter) => (
            <Button
              key={filter}
              type="button"
              size="sm"
              variant={listFilter === filter ? "brand" : "outline"}
              role="tab"
              aria-selected={listFilter === filter}
              data-testid={`chatsFilter-${filter}`}
              onClick={() => onChangeListFilter?.(filter)}
            >
              {filter === "inbox" ? "Inbox" : filter === "archived" ? "Archived" : "Muted"}
            </Button>
          ))}
        </div>
      </PageHeader>
      <MasterDetail
        listClassName={conversationId ? "hidden md:block" : undefined}
        detailClassName={!conversationId ? "hidden md:flex" : undefined}
        list={
        <aside className="px-3 py-3" aria-busy={inboxLoading || undefined}>
        <Link
          href="/requests"
          data-testid="chatsRequests"
          className="flex min-h-11 items-center justify-between py-2 text-sm"
        >
          <span>Message requests</span>
          {pendingRequests > 0 ? (
            <span className="rounded-full hc-brand-fill px-2 py-0.5 text-xs">
              {unreadLabel(pendingRequests)}
            </span>
          ) : null}
        </Link>

        {enableCta}

        <form
          className="mt-4 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (composeEnabled) onStartChat();
          }}
        >
          <Input
            value={peerDraft}
            onChange={(event) => onChangePeerDraft(event.target.value)}
            placeholder="Paste a pubky to start a chat"
            data-testid="chatsNewInput"
            autoCapitalize="none"
            autoCorrect="off"
            disabled={!composeEnabled}
          />
          <Button
            type="submit"
            variant="brand"
            size="sm"
            disabled={starting || !composeEnabled}
            data-testid="chatsNew"
          >
            {starting ? "Starting…" : "New chat"}
          </Button>
          {startError && !isReadOnlyTabError(new Error(startError)) ? (
            <ErrorDetails fallback="Could not start this chat." details={startError} />
          ) : null}
        </form>

        {inboxLoading && rows.length === 0 ? (
          <ul className="mt-4 space-y-2" data-testid="chatsLoading">
            <li><Skeleton className="h-14 w-full rounded-lg" /></li>
            <li><Skeleton className="h-14 w-full rounded-lg" /></li>
            <li><Skeleton className="h-14 w-full rounded-lg" /></li>
          </ul>
        ) : rows.length === 0 ? (
          <div className="mt-8 space-y-2" data-testid="chatsEmpty">
            <IllustratedEmptyState
              icon={IconMessageCircle}
              title="No chats yet."
              subtitle={emptyStateHint}
            >
              <Button asChild size="sm">
                <Link href="/contacts">Add a contact</Link>
              </Button>
            </IllustratedEmptyState>
          </div>
        ) : (
          <ul className="mt-4">
            {rows
              .filter((row) => {
                if (listFilter === "archived") return Boolean(row.archived);
                if (listFilter === "muted") return Boolean(row.muted);
                return !row.archived;
              })
              .map((row) => {
              const rowId = chatRowDomId(row.key);
              const labels = contactPrimaryLabel({
                nickname: row.nickname,
                displayName: row.displayName ?? (row.pubky ? null : row.title),
                pubky: row.pubky ?? row.title,
              });
              const labelName = labels.primary;
              const selected = conversationId !== null && row.href.endsWith(conversationId);
              return (
                <li key={row.key} className={selected ? "rounded-lg hc-wash px-2" : "px-2"}>
                  <Link
                    id={rowId}
                    href={row.href}
                    data-testid="chatRow"
                    aria-label={`Open chat ${labelName}`}
                    className="flex min-h-11 items-center gap-2 py-2 hover:bg-accent/40"
                    onClick={() => {
                      rememberAndOpen("chats", rowId);
                      rememberThreadOrigin({ kind: "chats" });
                    }}
                  >
                    <Avatar seed={row.pubky ?? row.title} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold">{labelName}</span>
                        {row.lastMessageAt ? (
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(row.lastMessageAt, now)}
                          </span>
                        ) : null}
                      </span>
                      {labels.secondary ? (
                        <span className="block truncate text-xs text-muted-foreground">{labels.secondary}</span>
                      ) : null}
                      <span className="mt-1 flex items-center justify-between gap-2">
                        <span className="truncate text-base text-muted-foreground">{row.preview}</span>
                        {row.linkStatus === "reconnect_required" ? (
                          <span className="text-xs font-light hc-brand-muted">
                            Connection lost — re-linking will be available in the next update.
                          </span>
                        ) : null}
                        {row.unreadCount > 0 ? (
                          <span className="rounded-full hc-brand-fill px-2 text-xs">
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
        {inboxError && !isReadOnlyTabError(new Error(inboxError)) ? (
          <div className="mt-3">
            <ErrorDetails
              fallback="Could not load your chats."
              details={inboxError}
              onRetry={onRetryInbox}
              live="status"
              repairHref="/settings#repair-local-data"
            />
          </div>
        ) : null}
        <p className="sr-only" role="status" aria-live="polite">
          {inboxLoading ? "Loading chats" : `${rows.length} chats`}
        </p>
      </aside>
        }
        detail={thread}
      />
    </div>
  );
}
