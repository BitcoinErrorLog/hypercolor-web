import { CHAT_ATTACHMENT_KIND } from "@/types/attachment";
import {
  GROUP_MEMBERSHIP_KIND,
  GROUP_REACTION_KIND,
  type GroupChannel,
} from "@/types/group";
import type { LinkConversationSummary } from "@/types/link";
import { queuedThreadSubtitle } from "@/lib/delivery-status";
import { isPaykitPaymentKind } from "@/types/payment";
import { paymentKindTitle } from "@/lib/payment-notice";

export type InboxKind = "dm" | "group";

export type InboxRow = {
  id: string;
  kind: InboxKind;
  title: string;
  preview: string;
  lastMessageAt: number;
  unreadCount: number;
  href: string;
};

export function groupConversationId(channelId: string): string {
  return `group:${channelId}`;
}

export function parseGroupConversationId(conversationId: string): string | null {
  if (!conversationId.startsWith("group:")) return null;
  const channelId = conversationId.slice("group:".length);
  return channelId.length > 0 ? channelId : null;
}

export function messagePreview(kind: string, body: string): string {
  if (kind === CHAT_ATTACHMENT_KIND) return "Attachment";
  if (isPaykitPaymentKind(kind)) return paymentKindTitle(kind);
  if (kind === GROUP_REACTION_KIND) return body.trim() || "Reaction";
  if (kind === GROUP_MEMBERSHIP_KIND) {
    switch (body) {
      case "create":
        return "Group created";
      case "add":
        return "Member added";
      case "remove":
        return "Member removed";
      case "leave":
        return "Member left";
      default:
        return body || "Membership update";
    }
  }
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed : "No messages yet";
}

export function inboxRowFromDm(row: LinkConversationSummary): InboxRow {
  const waiting = queuedThreadSubtitle({
    linkStatus: row.linkStatus,
    lastDeliveryState: row.lastDeliveryState,
    receiverRole: row.receiverRole,
  });
  const preview = waiting
    ? waiting
    : isPaykitPaymentKind(row.lastKind)
      ? paymentKindTitle(row.lastKind)
      : row.lastMessage || "No messages yet";
  return {
    id: row.conversationId,
    kind: "dm",
    title: row.participantPubky,
    preview,
    lastMessageAt: row.lastMessageAt,
    unreadCount: row.unreadCount,
    href: `/chats/${encodeURIComponent(row.conversationId)}`,
  };
}

export function inboxRowFromGroup(input: {
  channel: GroupChannel;
  preview: string;
  unreadCount: number;
}): InboxRow {
  return {
    id: input.channel.channelId,
    kind: "group",
    title: input.channel.name,
    preview: input.preview,
    lastMessageAt: input.channel.lastMessageAt ?? input.channel.updatedAt,
    unreadCount: input.unreadCount,
    href: `/channels/${encodeURIComponent(input.channel.channelId)}`,
  };
}

/** Unread conversations first, then most recent activity. */
export function sortInboxRows(rows: readonly InboxRow[]): InboxRow[] {
  return [...rows].sort((a, b) => {
    const unreadDiff = Number(b.unreadCount > 0) - Number(a.unreadCount > 0);
    if (unreadDiff !== 0) return unreadDiff;
    return b.lastMessageAt - a.lastMessageAt;
  });
}

export function dmInboxRows(dms: readonly LinkConversationSummary[]): InboxRow[] {
  return sortInboxRows(dms.map(inboxRowFromDm));
}

export function channelListRows(
  groups: readonly {
    channel: GroupChannel;
    preview: string;
    unreadCount: number;
  }[],
): InboxRow[] {
  return sortInboxRows(groups.map(inboxRowFromGroup));
}
