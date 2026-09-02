"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { Composer } from "@/components/composer";
import { DetailBackLink } from "@/components/detail-back";
import { DmMessageBubble } from "@/components/message-bubble";
import { ErrorDetails } from "@/components/error-details";
import { PaymentNotice } from "@/components/payment-notice";
import { TruncatedPubky } from "@/components/truncated-pubky";
import { describePaymentNotice, isPaymentMessageKind } from "@/lib/payment-notice";
import { isMessagingEnabled } from "@/lib/session-ui";
import { sanitizeDisplayName } from "@/lib/display-name";
import { CHAT_ATTACHMENT_KIND, type AttachmentRecord } from "@/types/attachment";
import type { LinkMessage } from "@/types/link";
import type { SessionUiStatus } from "@/stores/sessionStatusStore";

export function ThreadView({
  conversationId,
  participantPubky,
  displayName,
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
  displayName?: string | null;
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
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (conversationId) headingRef.current?.focus();
  }, [conversationId]);

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
        <DetailBackLink href="/chats" listLabel="Chats" />
        <h2 className="text-lg font-semibold">Invalid conversation</h2>
        <p className="text-sm text-muted-foreground">
          This path is not a DM conversation id.
        </p>
      </article>
    );
  }

  const title = displayName ? sanitizeDisplayName(displayName) : null;

  return (
    <article className="flex h-full min-h-[28rem] flex-col" data-testid="threadScreen">
      <header className="mb-4 flex items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0 space-y-2">
          <DetailBackLink href="/chats" listLabel="Chats" />
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Direct message</p>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold"
            data-testid="threadPeer"
          >
            {title ?? <TruncatedPubky pubky={participantPubky} />}
          </h2>
        </div>
        <Link
          href={`/contacts/${encodeURIComponent(participantPubky)}`}
          className="inline-flex min-h-11 items-center text-sm text-brand underline-offset-4 hover:underline"
        >
          Contact
        </Link>
      </header>

      {!isMessagingEnabled(status) ? enableCta : null}

      <div
        className="flex-1 space-y-3 overflow-y-auto py-4"
        aria-busy={loading || undefined}
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading messages…</p>
        ) : messages.length === 0 ? (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>No messages yet.</p>
            <p>Say something. Only the two of you can read this.</p>
          </div>
        ) : (
          messages.map((message) => {
            if (isPaymentMessageKind(message.kind)) {
              return (
                <PaymentNotice
                  key={`${message.senderPubky}:${message.kind}:${message.eventId}`}
                  notice={describePaymentNotice(message)}
                  mine={message.senderPubky === localPubky}
                />
              );
            }
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

      {error ? <ErrorDetails fallback="Could not load this thread." details={error} /> : null}

      {isMessagingEnabled(status) ? (
        <Composer
          draft={draft}
          sending={sending}
          placeholder="Message"
          onChangeDraft={onChangeDraft}
          onSend={onSend}
          onAttach={onAttach}
          testIdPrefix="thread"
          liveStatus={sending ? "Message sending" : null}
        />
      ) : null}
    </article>
  );
}
