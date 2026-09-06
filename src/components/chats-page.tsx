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
import { sanitizeDisplayName } from "@/lib/display-name";
import { displayPubkyShort } from "@/components/truncated-pubky";
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
            {rows.map((row) => {
              const rowId = chatRowDomId(row.key);
              const labelName = sanitizeDisplayName(displayPubkyShort(row.title));
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
                    <Avatar seed={row.title} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold">{displayPubkyShort(row.title)}</span>
                        {row.lastMessageAt ? (
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(row.lastMessageAt, now)}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2">
                        <span className="truncate text-base text-muted-foreground">{row.preview}</span>
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
