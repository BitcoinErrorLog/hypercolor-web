"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import { TruncatedPubky } from "@/components/truncated-pubky";
import { formatDeliveryStatus, isFailedDelivery } from "@/lib/delivery-status";
import { CHAT_ATTACHMENT_KIND } from "@/types/attachment";
import type { LinkMessage } from "@/types/link";
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
}: {
  message: LinkMessage;
  attachmentSlot?: ReactNode;
  mine: boolean;
  onRetry?: () => void;
}) {
  const failed = mine && isFailedDelivery(message.deliveryState);
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid="dmMessage" data-surface="message-bubble">
      <div
        className={`hc-bubble space-y-2 ${
          mine ? "hc-bubble-mine" : "hc-bubble-theirs"
        }`}
      >
        {attachmentSlot ?? (
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        )}
        <p className={`hc-meta ${mine ? "hc-on-brand-muted" : "text-muted-foreground"}`}>
          {formatClock(message.sentAt)}
          {mine ? ` · ${deliveryLabel(message.deliveryState)}` : ""}
        </p>
        {failed && onRetry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
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
  pressedEmojis,
}: {
  message: GroupMessage;
  attachmentSlot?: ReactNode;
  mine: boolean;
  localPubky: string | null;
  onRetry?: () => void;
  onReact?: (emoji: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  pressedEmojis?: readonly string[];
}) {
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
        className={`hc-bubble space-y-2 ${
          mine ? "hc-bubble-mine" : "hc-bubble-theirs"
        }`}
      >
        {!mine ? <TruncatedPubky pubky={message.senderPubky} className="font-mono text-xs opacity-80" /> : null}
        {message.deleted ? (
          <p className="italic opacity-70">Message deleted</p>
        ) : (
          attachmentSlot ?? (
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          )
        )}
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
          </div>
        ) : null}
        {failed && onRetry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
