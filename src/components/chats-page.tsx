"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { avatarInitial } from "@/components/avatar-initial";
import { ErrorDetails } from "@/components/error-details";
import { rememberAndOpen } from "@/components/detail-back";
import { sanitizeDisplayName } from "@/lib/display-name";
import { formatRelativeTime, shortPubky, unreadLabel } from "@/lib/format";
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
    <div className="hc-master-detail" data-testid="chatsScreen" data-surface="chats-page">
      <aside className={conversationId ? "hidden md:block" : undefined} aria-busy={inboxLoading || undefined}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight">
            Chats
          </h1>
        </div>

        <Link
          href="/requests"
          data-testid="chatsRequests"
          className="mb-4 flex min-h-11 items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
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
            size="sm"
            disabled={starting || !composeEnabled}
            data-testid="chatsNew"
          >
            {starting ? "Starting…" : "New chat"}
          </Button>
          {startError ? (
            <ErrorDetails
              fallback="Could not start this chat."
              details={startError}
              onTakeOver={() => {
                void import("@/services/tabLock").then((m) => m.requestTakeover());
              }}
            />
          ) : null}
        </form>

        {inboxLoading && rows.length === 0 ? (
          <ul className="mt-4 space-y-2" data-testid="chatsLoading">
            <li className="h-11 animate-pulse rounded-md bg-secondary" />
            <li className="h-11 animate-pulse rounded-md bg-secondary" />
            <li className="h-11 animate-pulse rounded-md bg-secondary" />
          </ul>
        ) : rows.length === 0 ? (
          <div className="mt-8 space-y-2" data-testid="chatsEmpty">
            <p className="text-muted-foreground">No chats yet.</p>
            <p className="text-sm text-muted-foreground">{emptyStateHint}</p>
            <Button asChild size="sm">
              <Link href="/contacts">Add a contact</Link>
            </Button>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {rows.map((row) => {
              const rowId = chatRowDomId(row.key);
              const labelName = sanitizeDisplayName(shortPubky(row.title));
              return (
                <li key={row.key}>
                  <Link
                    id={rowId}
                    href={row.href}
                    data-testid="chatRow"
                    aria-label={`Open chat ${labelName}`}
                    className="flex min-h-11 items-start gap-3 py-3 hover:bg-accent"
                    onClick={() => {
                      rememberAndOpen("chats", rowId);
                      rememberThreadOrigin({ kind: "chats" });
                    }}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary hc-brand-text">
                      {avatarInitial(labelName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{shortPubky(row.title)}</span>
                        {row.lastMessageAt ? (
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(row.lastMessageAt, now)}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-muted-foreground">{row.preview}</span>
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
        {inboxError ? (
          <div className="mt-3">
            <ErrorDetails
              fallback="Could not load your chats."
              details={inboxError}
              onRetry={onRetryInbox}
              live="status"
              onTakeOver={() => {
                void import("@/services/tabLock").then((m) => m.requestTakeover());
              }}
              repairHref="/settings#repair-local-data"
            />
          </div>
        ) : null}
        <p className="sr-only" role="status" aria-live="polite">
          {inboxLoading ? "Loading chats" : `${rows.length} chats`}
        </p>
      </aside>
      <section className={!conversationId ? "hidden md:block" : undefined}>{thread}</section>
    </div>
  );
}
