"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import { CHAT_ATTACHMENT_KIND } from "@/types/attachment";
import type { LinkDeliveryState, LinkMessage } from "@/types/link";
import {
  GROUP_MESSAGE_KIND,
  GROUP_MEMBERSHIP_KIND,
  PUBLIC_CHANNEL_MESSAGE_KIND,
  type GroupMessage,
} from "@/types/group";

function deliveryLabel(state: LinkDeliveryState): string {
  switch (state) {
    case "sending":
      return "sending";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
      return "read";
    case "failed":
      return "failed";
  }
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
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid="dmMessage">
      <div
        className={`max-w-[85%] space-y-2 rounded-2xl px-3 py-2 text-sm ${
          mine ? "bg-brand text-white" : "bg-card"
        }`}
      >
        {attachmentSlot ?? (
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        )}
        <p className={`text-[11px] ${mine ? "text-white/70" : "text-muted-foreground"}`}>
          {formatClock(message.sentAt)}
          {mine ? ` · ${deliveryLabel(message.deliveryState)}` : ""}
        </p>
        {mine && message.deliveryState === "failed" && onRetry ? (
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
}: {
  message: GroupMessage;
  attachmentSlot?: ReactNode;
  mine: boolean;
  localPubky: string | null;
  onRetry?: () => void;
  onReact?: (emoji: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
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

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid="groupMessage">
      <div
        className={`max-w-[85%] space-y-2 rounded-2xl px-3 py-2 text-sm ${
          mine ? "bg-brand text-white" : "bg-card"
        }`}
      >
        {!mine ? (
          <p className="font-mono text-[11px] opacity-70">{message.senderPubky}</p>
        ) : null}
        {message.deleted ? (
          <p className="italic opacity-70">Message deleted</p>
        ) : (
          attachmentSlot ?? (
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          )
        )}
        <p className={`text-[11px] ${mine ? "text-white/70" : "text-muted-foreground"}`}>
          {formatClock(message.sentAt)}
          {message.editedAt ? " · edited" : ""}
          {mine ? ` · ${deliveryLabel(message.deliveryState)}` : ""}
        </p>
        {!message.deleted && localPubky ? (
          <div className="flex flex-wrap gap-1">
            {["👍", "❤️", "😂", "🔥", "👎"].map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="rounded px-1 text-xs opacity-80 hover:opacity-100"
                onClick={() => onReact?.(emoji)}
              >
                {emoji}
              </button>
            ))}
            {mine && onEdit ? (
              <button type="button" className="text-xs underline" onClick={onEdit}>
                Edit
              </button>
            ) : null}
            {mine && onDelete ? (
              <button type="button" className="text-xs underline" onClick={onDelete}>
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
        {mine && message.deliveryState === "failed" && onRetry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
