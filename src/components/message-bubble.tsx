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
  tags = [],
  onToggleTag,
}: {
  message: LinkMessage;
  attachmentSlot?: ReactNode;
  mine: boolean;
  onRetry?: () => void;
  onCopy?: () => void;
  tags?: readonly ChatTagAggregate[];
  onToggleTag?: (label: string, mine: boolean) => void;
}) {
  const failed = mine && isFailedDelivery(message.deliveryState);
  const [pickerOpen, setPickerOpen] = useState(false);
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
        {attachmentSlot ?? (
          <MessageBody text={message.body} />
        )}
        <TagChips tags={tags} onToggle={onToggleTag} />
        <p className={`hc-meta ${mine ? "hc-on-brand-muted" : "text-muted-foreground"}`}>
          {formatClock(message.sentAt)}
          {mine ? ` · ${deliveryLabel(message.deliveryState)}` : ""}
        </p>
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
          {onCopy ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center text-sm underline opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 focus-visible:opacity-100"
              onClick={onCopy}
            >
              Copy
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
