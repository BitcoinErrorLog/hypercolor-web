"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Composer } from "@/components/composer";
import { DmMessageBubble } from "@/components/message-bubble";
import { shortPubky } from "@/lib/format";
import { isMessagingEnabled } from "@/lib/session-ui";
import { CHAT_ATTACHMENT_KIND, type AttachmentRecord } from "@/types/attachment";
import type { LinkMessage } from "@/types/link";
import type { SessionUiStatus } from "@/stores/sessionStatusStore";

export function ThreadView({
  conversationId,
  participantPubky,
  localPubky,
  messages,
  attachments,
  loading,
  error,
  draft,
  sending,
  status,
  enableCta,
  renderAttachment,
  onChangeDraft,
  onSend,
  onAttach,
  onRetry,
  onResolved,
}: {
  conversationId: string | null;
  participantPubky: string | null;
  localPubky: string | null;
  messages: LinkMessage[];
  attachments: AttachmentRecord[];
  loading: boolean;
  error: string | null;
  draft: string;
  sending: boolean;
  status: SessionUiStatus;
  enableCta: ReactNode;
  renderAttachment: (record: AttachmentRecord, onResolved: () => void) => ReactNode;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  onAttach: (file: File) => void;
  onRetry: () => void;
  onResolved: () => void;
}) {
  if (!conversationId) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center text-sm text-muted-foreground">
        Select a conversation.
      </div>
    );
  }

  if (!participantPubky) {
    return (
      <article className="space-y-3">
        <h2 className="text-lg font-semibold">Invalid conversation</h2>
        <p className="text-sm text-muted-foreground">
          This path is not a DM conversation id.
        </p>
      </article>
    );
  }

  return (
    <article className="flex h-full min-h-[28rem] flex-col" data-testid="threadScreen">
      <header className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Direct message</p>
          <h2 className="break-all font-mono text-sm" data-testid="threadPeer">
            {participantPubky}
          </h2>
        </div>
        <Link
          href={`/contacts/${encodeURIComponent(participantPubky)}`}
          className="text-sm text-brand underline-offset-4 hover:underline"
        >
          {shortPubky(participantPubky)}
        </Link>
      </header>

      {!isMessagingEnabled(status) ? enableCta : null}

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet. Send the first one.</p>
        ) : (
          messages.map((message) => {
            const attachment =
              message.kind === CHAT_ATTACHMENT_KIND
                ? attachments.find((row) => row.eventId === message.eventId)
                : undefined;
            return (
              <DmMessageBubble
                key={`${message.senderPubky}:${message.kind}:${message.eventId}`}
                message={message}
                attachmentSlot={
                  attachment ? renderAttachment(attachment, onResolved) : undefined
                }
                mine={message.senderPubky === localPubky}
                onRetry={onRetry}
              />
            );
          })
        )}
      </div>

      {error ? <p className="mb-2 text-sm text-red-400">{error}</p> : null}

      <Composer
        draft={draft}
        sending={sending}
        disabled={!isMessagingEnabled(status)}
        placeholder="Message"
        onChangeDraft={onChangeDraft}
        onSend={onSend}
        onAttach={onAttach}
        testIdPrefix="thread"
      />
    </article>
  );
}
