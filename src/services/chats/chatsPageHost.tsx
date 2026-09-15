"use client";

import { useGuardedRouter } from "@/hooks/useBlockingGate";
import { useEffect, useRef, useState } from "react";
import { EnableMessagingCta } from "@/components/enable-messaging-cta";
import { CHATS_EMPTY_STATE_CANDIDATE_HINT, ChatsPage, type ChatsPageRow } from "@/components/chats-page";
import { useInbox } from "@/hooks/useInbox";
import { usePathSegment } from "@/hooks/usePathSegment";
import { addManualContact } from "@/services/contacts/addManualContact";
import { ThreadViewHost } from "@/services/thread/threadActions";
import { fetchAssignment } from "@/services/vibeware/assignment";
import { emit } from "@/services/vibeware/collector";
import { useContactStore } from "@/stores/contactStore";
import type { InboxRow } from "@/lib/inbox";
import { buildDmConversationId } from "@/types/link";
import { rememberThreadOrigin } from "@/lib/list-detail-focus";
import { parsePubky } from "@/utils/pubkyId";
import { dmThreadKey } from "@/lib/contact-label";
import { LocalChatState } from "@/services/localChatState";

export function mapInboxRowsToChatsPageRows(
  rows: InboxRow[],
  extras?: { nicknames?: Record<string, string>; flags?: Record<string, { muted: boolean; archived: boolean }> },
): ChatsPageRow[] {
  return rows
    .filter((row) => row.kind === "dm")
    .map((row) => {
      const pubky = row.id.startsWith("dm:") ? row.id.slice(3) : row.title;
      const flags = extras?.flags?.[dmThreadKey(row.id)];
      return {
        key: row.id,
        href: row.href,
        title: row.title,
        kind: "dm" as const,
        preview: row.preview,
        lastMessageAt: row.lastMessageAt,
        unreadCount: row.unreadCount,
        nickname: extras?.nicknames?.[pubky] ?? null,
        pubky,
        muted: flags?.muted,
        archived: flags?.archived,
        linkStatus: row.linkStatus,
      };
    });
}

export function ChatsPageHost() {
  const conversationId = usePathSegment("chats");
  const router = useGuardedRouter();
  const inbox = useInbox();
  const upsertContact = useContactStore((s) => s.upsertContact);
  const [peerDraft, setPeerDraft] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [emptyStateHint, setEmptyStateHint] = useState<string | undefined>(undefined);
  const emptyEmitted = useRef(false);
  const [listFilter, setListFilter] = useState<"inbox" | "archived" | "muted">("inbox");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<{ threadKey: string; eventId: string; snippet: string }[]>([]);
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, { muted: boolean; archived: boolean }>>({});

  useEffect(() => {
    if (!inbox.ownerPubky) return;
    void LocalChatState.getNicknames(inbox.ownerPubky).then(setNicknames);
    void LocalChatState.listThreadFlags(inbox.ownerPubky).then((map) => {
      const next: Record<string, { muted: boolean; archived: boolean }> = {};
      for (const [key, value] of Object.entries(map)) {
        next[key] = { muted: value.muted, archived: value.archived };
      }
      setFlags(next);
    });
  }, [inbox.ownerPubky, inbox.rows]);

  useEffect(() => {
    if (!inbox.ownerPubky || !searchQuery.trim()) {
      return;
    }
    const handle = window.setTimeout(() => {
      void LocalChatState.searchMessages(inbox.ownerPubky!, searchQuery).then((hits) => {
        setSearchHits(hits.map((hit) => ({ threadKey: hit.threadKey, eventId: hit.eventId, snippet: hit.bodyNorm })));
      });
    }, 150);
    return () => window.clearTimeout(handle);
  }, [inbox.ownerPubky, searchQuery]);

  useEffect(() => {
    let cancelled = false;
    void fetchAssignment().then((assignment) => {
      if (cancelled) return;
      if (assignment.bucket === "candidate") {
        setEmptyStateHint(CHATS_EMPTY_STATE_CANDIDATE_HINT);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (inbox.loading) return;
    const timer = window.setTimeout(() => {
      if (emptyEmitted.current) return;
      if (inbox.loading) return;
      if (inbox.rows.length !== 0) return;
      emptyEmitted.current = true;
      void emit("app.chat.empty_state", { kind: "dms" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [inbox.loading, inbox.rows.length]);

  async function startChat() {
    if (!inbox.ownerPubky) {
      setStartError("Connect with Pubky Ring first.");
      void emit("app.error.coarse", { code: "auth", surface: "chats" });
      return;
    }
    const parsed = parsePubky(peerDraft);
    if (!parsed) {
      setStartError("Paste a 52-character z-base-32 pubky.");
      void emit("app.error.coarse", { code: "validation", surface: "chats" });
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const result = await addManualContact(inbox.ownerPubky, parsed);
      if (!result.ok) {
        setStartError(result.message);
        void emit("app.error.coarse", { code: "validation", surface: "chats" });
        return;
      }
      upsertContact(result.contact);
      setPeerDraft("");
      rememberThreadOrigin({ kind: "chats" });
      router.push(`/chats/${encodeURIComponent(buildDmConversationId(result.contact.pubky))}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <ChatsPage
      conversationId={conversationId}
      enableCta={<EnableMessagingCta testId="chatsEnableMessaging" />}
      thread={<ThreadViewHost conversationId={conversationId} />}
      rows={mapInboxRowsToChatsPageRows(inbox.rows, { nicknames, flags })}
      listFilter={listFilter}
      onChangeListFilter={setListFilter}
      searchQuery={searchQuery}
      onChangeSearchQuery={setSearchQuery}
      searchHits={searchQuery.trim() ? searchHits : []}
      pendingRequests={inbox.pendingRequests}
      inboxError={inbox.error}
      inboxLoading={inbox.loading}
      onRetryInbox={() => {
        void inbox.refresh();
      }}
      peerDraft={peerDraft}
      starting={starting}
      startError={startError}
      status={inbox.status}
      emptyStateHint={emptyStateHint}
      onChangePeerDraft={setPeerDraft}
      onStartChat={() => {
        void startChat();
      }}
    />
  );
}
