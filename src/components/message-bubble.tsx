"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { MessageBody } from "@/components/message-body";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import { TruncatedPubky } from "@/components/truncated-pubky";
import { formatDeliveryStatus, isFailedDelivery } from "@/lib/delivery-status";
import { CHAT_ATTACHMENT_KIND } from "@/types/attachment";
import type { LinkMessage } from "@/types/link";
import type { ChatTagAggregate } from "@/types/chatKinds";
import { TagChips, TagPicker } from "@/components/tag-picker";
import { ModalSheet } from "@/components/ui/sheet";
import { isPaykitPaymentKind } from "@/types/payment";
import {
  GROUP_MESSAGE_KIND,
  GROUP_MEMBERSHIP_KIND,
  PUBLIC_CHANNEL_MESSAGE_KIND,
  type GroupMessage,
} from "@/types/group";

const REACTIONS = [
  { emoji: "👍", name: "thumbs up" },
  { emoji: "❤️", name: "heart" },
  { emoji: "😂", name: "joy" },
  { emoji: "🔥", name: "fire" },
  { emoji: "👎", name: "thumbs down" },
] as const;

function deliveryLabel(state: LinkMessage["deliveryState"]): string {
  return formatDeliveryStatus(state);
}

export function DmMessageBubble({
  message,
  attachmentSlot,
  mine,
  onRetry,
  onCopy,
  onUnsend,
  tags = [],
  onToggleTag,
}: {
  message: LinkMessage;
  attachmentSlot?: ReactNode;
  mine: boolean;
  onRetry?: () => void;
  onCopy?: () => void;
  onUnsend?: () => Promise<void>;
  tags?: readonly ChatTagAggregate[];
  onToggleTag?: (label: string, mine: boolean) => void;
}) {
  const failed = mine && isFailedDelivery(message.deliveryState);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unsendOpen, setUnsendOpen] = useState(false);
  const [unsending, setUnsending] = useState(false);
  const [unsendError, setUnsendError] = useState(false);
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid="dmMessage" data-surface="message-bubble">
      <div
        className={`group hc-bubble space-y-2 ${
          mine ? "hc-bubble-mine" : "hc-bubble-theirs"
        }`}
        onContextMenu={(event) => {
          event.preventDefault();
          setPickerOpen(true);
        }}
      >
        {message.deleted ? (
          <p className="italic opacity-70">Message unsent</p>
        ) : (
          attachmentSlot ?? <MessageBody text={message.body} />
        )}
        <TagChips tags={tags} onToggle={onToggleTag} />
        {!message.deleted ? (
          <p className={`hc-meta ${mine ? "hc-on-brand-muted" : "text-muted-foreground"}`}>
            {formatClock(message.sentAt)}
            {mine ? ` · ${deliveryLabel(message.deliveryState)}` : ""}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1">
          {onToggleTag ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center text-sm underline opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 focus-visible:opacity-100"
              onClick={() => setPickerOpen((open) => !open)}
            >
              Tag
            </button>
          ) : null}
          {onCopy && !message.deleted ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center text-sm underline opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 focus-visible:opacity-100"
              onClick={onCopy}
            >
              Copy
            </button>
          ) : null}
          {mine && onUnsend && !message.deleted && !isPaykitPaymentKind(message.kind) ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center text-sm underline"
              onClick={() => {
                setUnsendError(false);
                setUnsendOpen(true);
              }}
            >
              Unsend
            </button>
          ) : null}
        </div>
        <TagPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onPick={(label) => onToggleTag?.(label, false)}
        />
        {failed && onRetry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        <ModalSheet
          open={unsendOpen}
          onClose={() => {
            if (!unsending) setUnsendOpen(false);
          }}
          role="alertdialog"
          titleId={`unsend-title-${message.eventId}`}
          descriptionId={`unsend-body-${message.eventId}`}
          testId="unsendDialog"
          surface="unsend-confirm"
        >
          <h2 id={`unsend-title-${message.eventId}`} className="text-lg font-semibold">
            Unsend message
          </h2>
          <p id={`unsend-body-${message.eventId}`} className="text-sm text-muted-foreground">
            This message will be unsent for everyone.
          </p>
          {unsendError ? <p className="text-sm hc-danger-text">Could not unsend this message.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={unsending}
              data-testid="unsendCancel"
              onClick={() => setUnsendOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={unsending}
              data-testid="unsendConfirm"
              onClick={() => {
                if (!onUnsend || unsending) return;
                setUnsending(true);
                setUnsendError(false);
                void onUnsend()
                  .then(() => setUnsendOpen(false))
                  .catch(() => setUnsendError(true))
                  .finally(() => setUnsending(false));
              }}
            >
              {unsending ? "Unsending…" : "Unsend"}
            </Button>
          </div>
        </ModalSheet>
      </div>
    </div>
  );
}

export function GroupMessageBubble({
  message,
  attachmentSlot,
  mine,
  localPubky,
  onRetry,
  onReact,
  onEdit,
  onDelete,
  onReply,
  onCopy,
  pressedEmojis,
  quotedBody,
  tags = [],
  onToggleTag,
}: {
  message: GroupMessage;
  attachmentSlot?: ReactNode;
  mine: boolean;
  localPubky: string | null;
  onRetry?: () => void;
  onReact?: (emoji: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onReply?: () => void;
  onCopy?: () => void;
  pressedEmojis?: readonly string[];
  quotedBody?: string | null;
  tags?: readonly ChatTagAggregate[];
  onToggleTag?: (label: string, mine: boolean) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  if (message.kind === GROUP_MEMBERSHIP_KIND) {
    return (
      <p className="text-center text-xs text-muted-foreground" data-testid="groupMembership">
        {message.body}
      </p>
    );
  }
  if (
    message.kind !== GROUP_MESSAGE_KIND &&
    message.kind !== PUBLIC_CHANNEL_MESSAGE_KIND &&
    message.kind !== CHAT_ATTACHMENT_KIND
  ) {
    return null;
  }

  const publicTopic = message.kind === PUBLIC_CHANNEL_MESSAGE_KIND;
  const failed = mine && isFailedDelivery(message.deliveryState);

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid="groupMessage" data-surface="message-bubble">
      <div
        className={`group hc-bubble space-y-2 ${
          mine ? "hc-bubble-mine" : "hc-bubble-theirs"
        }`}
        onContextMenu={(event) => {
          event.preventDefault();
          setPickerOpen(true);
        }}
      >
        {!mine ? <TruncatedPubky pubky={message.senderPubky} className="font-mono text-xs opacity-80" /> : null}
        {quotedBody ? (
          <blockquote className="border-l-2 border-border pl-2 text-xs opacity-80" data-testid="groupQuote">
            {quotedBody}
          </blockquote>
        ) : null}
        {message.deleted ? (
          <p className="italic opacity-70">Message deleted</p>
        ) : (
          attachmentSlot ?? (
            <MessageBody text={message.body} />
          )
        )}
        <TagChips tags={tags} onToggle={onToggleTag} />
        <p className={`hc-meta ${mine ? "hc-on-brand-muted" : "text-muted-foreground"}`}>
          {formatClock(message.sentAt)}
          {message.editedAt ? " · edited" : ""}
          {mine && !publicTopic ? ` · ${deliveryLabel(message.deliveryState)}` : ""}
        </p>
        {!message.deleted && localPubky ? (
          <div className="flex flex-wrap gap-1">
            {REACTIONS.map((reaction) => {
              const pressed = Boolean(pressedEmojis?.includes(reaction.emoji));
              return (
              <button
                key={reaction.emoji}
                type="button"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded px-1 text-sm opacity-80 hover:opacity-100"
                aria-label={`React with ${reaction.name}`}
                aria-pressed={pressed}
                onClick={() => onReact?.(reaction.emoji)}
              >
                {reaction.emoji}
              </button>
              );
            })}
            {mine && onEdit ? (
              <button
                type="button"
                className="inline-flex min-h-11 items-center text-sm underline"
                onClick={onEdit}
              >
                Edit
              </button>
            ) : null}
            {mine && onDelete ? (
              <button
                type="button"
                className="inline-flex min-h-11 items-center text-sm underline"
                onClick={onDelete}
              >
                Delete
              </button>
            ) : null}
            {onReply ? (
              <button
                type="button"
                className="inline-flex min-h-11 items-center text-sm underline"
                data-testid="groupReply"
                onClick={onReply}
              >
                Reply
              </button>
            ) : null}
            {onCopy ? (
              <button
                type="button"
                className="inline-flex min-h-11 items-center text-sm underline opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 focus-visible:opacity-100"
                onClick={onCopy}
              >
                Copy
              </button>
            ) : null}
            {onToggleTag ? (
              <button
                type="button"
                className="inline-flex min-h-11 items-center text-sm underline opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 focus-visible:opacity-100"
                onClick={() => setPickerOpen((open) => !open)}
              >
                Tag
              </button>
            ) : null}
          </div>
        ) : null}
        <TagPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onPick={(label) => onToggleTag?.(label, false)}
        />
        {failed && onRetry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
