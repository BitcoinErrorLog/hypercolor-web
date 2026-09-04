"use client";

import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Composer } from "@/components/composer";
import { DetailBackLink } from "@/components/detail-back";
import { DetailHeading } from "@/components/detail-heading";
import { DmMessageBubble } from "@/components/message-bubble";
import { ErrorDetails } from "@/components/error-details";
import { PaymentNotice } from "@/components/payment-notice";
import { TruncatedPubky } from "@/components/truncated-pubky";
import { describePaymentNotice, isPaymentMessageKind } from "@/lib/payment-notice";
import { canComposeMessages } from "@/lib/session-ui";
import { sanitizeDisplayName } from "@/lib/display-name";
import {
  getServerThreadOrigin,
  peekThreadOrigin,
  subscribeThreadOrigin,
  takeThreadOrigin,
  threadBackHref,
  threadBackLabel,
} from "@/lib/list-detail-focus";
import { CHAT_ATTACHMENT_KIND, type AttachmentRecord } from "@/types/attachment";
import type { LinkMessage } from "@/types/link";
import {
  decodePaymentEnvelope,
  displayPaymentStatus,
  type PaymentDisplayStatus,
  PAYKIT_PAYMENT_ACCEPTANCE_KIND,
  PAYKIT_PAYMENT_CANCELLATION_KIND,
  PAYKIT_PAYMENT_PROOF_KIND,
  PAYKIT_PAYMENT_REJECTION_KIND,
  PAYKIT_PAYMENT_REQUEST_KIND,
  PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
} from "@/types/payment";
import type { SessionUiStatus } from "@/stores/sessionStatusStore";

export function paymentDisplayStatusText(status: PaymentDisplayStatus): string {
  switch (status) {
    case "accepted":
      return "Accepted";
    case "claimed":
      return "Payment proof could not be verified yet";
    case "verified":
      return "Paid";
    case "expired":
      return "Expired before acceptance";
    case "rejected":
    case "cancelled":
      return "Failed before wallet handoff";
    case "pending":
      return "Requested by peer";
    case "proof_received":
      return "Payment proof could not be verified yet";
    case "sending":
      return "Sending";
    default:
      return "Payment";
  }
}

export function paymentNoticeStatus(message: LinkMessage, mine: boolean, now?: number): string {
  const decoded =
    (message.rawJson ? decodePaymentEnvelope(message.rawJson) : null) ??
    (message.body ? decodePaymentEnvelope(message.body) : null);

  if (decoded?.kind === PAYKIT_PAYMENT_REQUEST_KIND) {
    const expiresAt = decoded.request.proposal_expires_at
      ? Date.parse(decoded.request.proposal_expires_at)
      : null;
    const status = displayPaymentStatus("pending", expiresAt, now ?? Date.now());
    if (mine && status === "pending") return "Requested";
    return paymentDisplayStatusText(status);
  }

  switch (message.kind) {
    case PAYKIT_PAYMENT_ACCEPTANCE_KIND:
      return paymentDisplayStatusText(displayPaymentStatus("accepted", null, now ?? Date.now()));
    case PAYKIT_PAYMENT_PROOF_KIND:
      return paymentDisplayStatusText(
        displayPaymentStatus("proof_received", null, now ?? Date.now(), { proofVerified: null }),
      );
    case PAYKIT_PAYMENT_REJECTION_KIND:
      return paymentDisplayStatusText(displayPaymentStatus("rejected", null, now ?? Date.now()));
    case PAYKIT_PAYMENT_CANCELLATION_KIND:
      return paymentDisplayStatusText(displayPaymentStatus("cancelled", null, now ?? Date.now()));
    case PAYKIT_PRIVATE_PAYMENT_LIST_KIND:
      return "Unverified payment methods";
    default:
      return "Payment";
  }
}

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
  now,
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
  now?: number;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const origin = useSyncExternalStore(
    subscribeThreadOrigin,
    peekThreadOrigin,
    getServerThreadOrigin,
  );
  const backHref = threadBackHref(origin);
  const backLabel = threadBackLabel(origin);
  const backAlways = origin?.kind === "contact";

  useEffect(() => {
    if (conversationId) headingRef.current?.focus();
  }, [conversationId]);

  if (!conversationId) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center text-sm text-muted-foreground" data-surface="thread-view">
        Select a conversation.
      </div>
    );
  }

  if (!participantPubky) {
    return (
      <article className="space-y-3" data-surface="thread-view">
        <DetailBackLink
          href={backHref}
          listLabel={backLabel}
          always={backAlways}
          onNavigate={() => takeThreadOrigin()}
        />
        <DetailHeading headingRef={headingRef} className="text-lg font-semibold">
          Invalid conversation
        </DetailHeading>
        <p className="text-sm text-muted-foreground">
          This path is not a DM conversation id.
        </p>
      </article>
    );
  }

  const title = displayName ? sanitizeDisplayName(displayName) : null;
  const mayCompose = canComposeMessages(status);

  return (
    <article className="flex h-full hc-detail-panel flex-col" data-testid="threadScreen" data-surface="thread-view">
      <header className="mb-4 flex items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0 space-y-2">
          <DetailBackLink
            href={backHref}
            listLabel={backLabel}
            always={backAlways}
            onNavigate={() => takeThreadOrigin()}
          />
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Direct message</p>
          <DetailHeading
            headingRef={headingRef}
            className="text-lg font-semibold"
            testId="threadPeer"
          >
            {title ?? <TruncatedPubky pubky={participantPubky} />}
          </DetailHeading>
        </div>
        <Link
          href={`/contacts/${encodeURIComponent(participantPubky)}`}
          className="inline-flex min-h-11 items-center text-sm hc-brand-text underline-offset-4 hover:underline"
        >
          Contact
        </Link>
      </header>

      {!mayCompose ? enableCta : null}

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
                  status={paymentNoticeStatus(message, message.senderPubky === localPubky, now)}
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

      {error ? (
        <ErrorDetails fallback="Could not load this thread." details={error} live="status" />
      ) : null}

      {mayCompose ? (
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
