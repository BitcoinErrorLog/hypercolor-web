"use client";

import { useRouter } from "next/navigation";
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
import { parsePubky } from "@/utils/pubkyId";

export function mapInboxRowsToChatsPageRows(rows: InboxRow[]): ChatsPageRow[] {
  return rows.map((row) => ({
    key: `${row.kind}:${row.id}`,
    href: row.href,
    title: row.title,
    kind: row.kind,
    preview: row.preview,
    lastMessageAt: row.lastMessageAt,
    unreadCount: row.unreadCount,
  }));
}

export function ChatsPageHost() {
  const conversationId = usePathSegment("chats");
  const router = useRouter();
  const inbox = useInbox();
  const upsertContact = useContactStore((s) => s.upsertContact);
  const [peerDraft, setPeerDraft] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [emptyStateHint, setEmptyStateHint] = useState<string | undefined>(undefined);
  const emptyEmitted = useRef(false);

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
      rows={mapInboxRowsToChatsPageRows(inbox.rows)}
      pendingRequests={inbox.pendingRequests}
      inboxError={inbox.error}
      peerDraft={peerDraft}
      starting={starting}
      startError={startError}
      emptyStateHint={emptyStateHint}
      onChangePeerDraft={setPeerDraft}
      onStartChat={() => {
        void startChat();
      }}
    />
  );
}
