"use client";

import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Composer, type ComposerQuote } from "@/components/composer";
import { StandbyReceiveButton } from "@/components/standby-takeover-dialog";
import { STANDBY_PRIMARY } from "@/services/link/provisionReceiver";
import { Button } from "@/components/ui/button";
import { DetailBackLink } from "@/components/detail-back";
import { DetailHeading } from "@/components/detail-heading";
import { DmMessageBubble } from "@/components/message-bubble";
import { ErrorDetails } from "@/components/error-details";
import { isReadOnlyTabError } from "@/db/errors";
import { PaymentNotice } from "@/components/payment-notice";
import { TruncatedPubky } from "@/components/truncated-pubky";
import { describePaymentNotice, isPaymentMessageKind } from "@/lib/payment-notice";
import { queuedThreadSubtitle, STANDBY_COMPOSER_NOTICE, CONNECTION_CHANGED_RETRY, isStandbyNewChatBlocked } from "@/lib/delivery-status";
import { canComposeMessages } from "@/lib/session-ui";
import { withDaySeparators } from "@/lib/day-separators";
import { dataTransferFiles } from "@/lib/attach-file";
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
import type { LinkMessage, ReceiverRole } from "@/types/link";
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
  onTakeoverReceive,
  now,
  receiverRole = null,
  linkStatus = null,
  linkSnapshot = null,
  linkReady,
  nickname = null,
  muted = false,
  archived = false,
  onToggleMute,
  onToggleArchive,
  quote = null,
  onClearQuote,
  pendingFile = null,
  pendingPreviewUrl = null,
  pendingError = null,
  onConfirmPending,
  onCancelPending,
  gifConfigured = false,
  onPickGif,
  onOfferAttach,
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
  onTakeoverReceive?: () => Promise<void>;
  receiverRole?: ReceiverRole | null;
  linkStatus?: string | null;
  linkSnapshot?: string | null;
  linkReady?: boolean;
  now?: number;
  nickname?: string | null;
  muted?: boolean;
  archived?: boolean;
  onToggleMute?: () => void;
  onToggleArchive?: () => void;
  quote?: ComposerQuote | null;
  onClearQuote?: () => void;
  pendingFile?: File | null;
  pendingPreviewUrl?: string | null;
  pendingError?: string | null;
  onConfirmPending?: () => void;
  onCancelPending?: () => void;
  gifConfigured?: boolean;
  onPickGif?: (hit: { id: string; width: number; height: number }) => void;
  onOfferAttach?: (file: File) => void;
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
      <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center text-sm text-muted-foreground" data-surface="thread-view">
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
  const standbyBlocked = isStandbyNewChatBlocked(receiverRole, linkStatus, {
    snapshot: linkSnapshot,
    linkReady,
  });
  const queuedSubtitle = queuedThreadSubtitle({
    linkStatus,
    lastDeliveryState: messages.some(
      (message) => message.direction === "sent" && message.deliveryState === "sending",
    )
      ? "sending"
      : null,
    receiverRole,
  });

  return (
    <article className="flex h-full hc-detail-panel flex-col" data-testid="threadScreen" data-surface="thread-view">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
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
            {nickname ? sanitizeDisplayName(nickname) : title ?? <TruncatedPubky pubky={participantPubky} />}
          </DetailHeading>
          {nickname && title ? (
            <p className="text-sm text-muted-foreground">{title}</p>
          ) : null}
          {linkStatus === "error" ? (
            <button
              type="button"
              data-testid="threadLinkRetry"
              className="text-sm font-light hc-brand-muted underline-offset-4 hover:underline"
              onClick={onRetry}
            >
              {CONNECTION_CHANGED_RETRY}
            </button>
          ) : queuedSubtitle ? (
            <p className="text-sm font-light hc-brand-muted" data-testid="queuedHandshakeSubtitle">
              {queuedSubtitle}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {onToggleMute ? (
            <Button type="button" size="sm" variant="outline" onClick={onToggleMute} data-testid="threadMute">
              {muted ? "Unmute" : "Mute"}
            </Button>
          ) : null}
          {onToggleArchive ? (
            <Button type="button" size="sm" variant="outline" onClick={onToggleArchive} data-testid="threadArchive">
              {archived ? "Unarchive" : "Archive"}
            </Button>
          ) : null}
        <Link
          href={`/contacts/${encodeURIComponent(participantPubky)}`}
          className="inline-flex min-h-11 items-center text-sm hc-brand-text underline-offset-4 hover:underline"
        >
          Contact
        </Link>
        </div>
      </header>

      {!mayCompose ? enableCta : null}

      <div
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
        aria-busy={loading || undefined}
        onDragOver={(event) => {
          if (!onOfferAttach) return;
          event.preventDefault();
        }}
        onDrop={(event) => {
          if (!onOfferAttach) return;
          event.preventDefault();
          for (const file of dataTransferFiles(event.dataTransfer)) onOfferAttach(file);
        }}
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading messages…</p>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center space-y-1 text-sm text-muted-foreground">
            <p>No messages yet.</p>
            <p>Say something. Only the two of you can read this.</p>
          </div>
        ) : (
          withDaySeparators(messages, now).map((bucket) => {
            if (bucket.kind === "separator") {
              return (
                <p key={bucket.key} className="text-center text-xs text-muted-foreground" data-testid="daySeparator">
                  {bucket.label}
                </p>
              );
            }
            const message = bucket.item;
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
                onCopy={() => {
                  void navigator.clipboard.writeText(message.body);
                }}
              />
            );
          })
        )}
      </div>

      {error && !isReadOnlyTabError(new Error(error)) ? (
        <ErrorDetails fallback="Could not load this thread." details={error} live="status" />
      ) : null}

      {mayCompose ? (
        <>
          {standbyBlocked ? (
            <div className="space-y-2 border-t border-border px-4 py-3" data-testid="standbyComposerNotice">
              <p id="threadSendBlockedReason" className="text-sm text-muted-foreground">
                {STANDBY_COMPOSER_NOTICE}
              </p>
              {onTakeoverReceive ? (
                <StandbyReceiveButton testId="threadStandbyTakeover" onTakeover={onTakeoverReceive}>
                  {STANDBY_PRIMARY}
                </StandbyReceiveButton>
              ) : null}
            </div>
          ) : null}
          <Composer
            draft={draft}
            sending={sending}
            sendBlocked={standbyBlocked}
            sendBlockedReason={standbyBlocked ? STANDBY_COMPOSER_NOTICE : undefined}
            placeholder="Message"
            onChangeDraft={onChangeDraft}
            onSend={onSend}
            onAttach={onOfferAttach ?? onAttach}
            testIdPrefix="thread"
            liveStatus={sending ? "Message sending" : null}
            quote={quote}
            onClearQuote={onClearQuote}
            pendingFile={pendingFile}
            pendingPreviewUrl={pendingPreviewUrl}
            pendingError={pendingError}
            onConfirmPending={onConfirmPending}
            onCancelPending={onCancelPending}
            gifConfigured={gifConfigured}
            onPickGif={onPickGif}
          />
        </>
      ) : null}
    </article>
  );
}
