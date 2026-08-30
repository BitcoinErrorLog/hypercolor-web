"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sanitizeDisplayName } from "@/lib/display-name";
import { formatRelativeTime, shortPubky, unreadLabel } from "@/lib/format";

export type ChatsPageRow = {
  key: string;
  href: string;
  title: string;
  kind: "dm" | "group";
  preview: string;
  lastMessageAt: number;
  unreadCount: number;
};

export function ChatsPage({
  conversationId,
  enableCta,
  thread,
  rows,
  pendingRequests,
  inboxError,
  peerDraft,
  starting,
  startError,
  onChangePeerDraft,
  onStartChat,
}: {
  conversationId: string | null;
  enableCta: ReactNode;
  thread: ReactNode;
  rows: ChatsPageRow[];
  pendingRequests: number;
  inboxError: string | null;
  peerDraft: string;
  starting: boolean;
  startError: string | null;
  onChangePeerDraft: (value: string) => void;
  onStartChat: () => void;
}) {
  return (
    <div className="grid min-h-[70vh] gap-6 md:grid-cols-[minmax(16rem,20rem)_1fr]" data-testid="chatsScreen">
      <aside className={conversationId ? "hidden md:block" : undefined}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Chats</h1>
          <Link
            href="/requests"
            className="text-sm text-brand underline-offset-4 hover:underline"
            data-testid="chatsRequests"
          >
            Requests{pendingRequests > 0 ? ` (${pendingRequests})` : ""}
          </Link>
        </div>

        {enableCta}

        <form
          className="mt-4 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            onStartChat();
          }}
        >
          <Input
            value={peerDraft}
            onChange={(event) => onChangePeerDraft(event.target.value)}
            placeholder="Paste a pubky to start a chat"
            data-testid="chatsNewInput"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <Button type="submit" size="sm" disabled={starting} data-testid="chatsNew">
            {starting ? "Starting…" : "New chat"}
          </Button>
          {startError ? <p className="text-sm text-red-400">{startError}</p> : null}
        </form>

        {rows.length === 0 ? (
          <div className="mt-8 space-y-2" data-testid="chatsEmpty">
            <p className="text-muted-foreground">No conversations yet.</p>
            <p className="text-sm text-muted-foreground">
              Search for a contact to start chatting.
            </p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {rows.map((row) => (
              <li key={row.key}>
                <Link
                  href={row.href}
                  data-testid="chatRow"
                  aria-label={row.title}
                  className="flex items-start gap-3 py-3 hover:bg-accent/40"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-brand">
                    {row.title.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">
                        {row.kind === "group" ? sanitizeDisplayName(row.title) : shortPubky(row.title)}
                      </span>
                      {row.lastMessageAt ? (
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(row.lastMessageAt)}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-muted-foreground">
                        {row.kind === "group" ? `Group · ${row.preview}` : row.preview}
                      </span>
                      {row.unreadCount > 0 ? (
                        <span className="rounded-full bg-brand px-2 text-xs text-white">
                          {unreadLabel(row.unreadCount)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {inboxError ? <p className="mt-3 text-sm text-red-400">{inboxError}</p> : null}
      </aside>
      <section className={!conversationId ? "hidden md:block" : undefined}>
        {thread}
      </section>
    </div>
  );
}
