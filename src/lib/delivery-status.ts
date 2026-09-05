import type { LinkDeliveryState } from "@/types/link";

export type DeliveryStatusLabel = "Queued" | "Sent" | "Failed";

export const QUEUED_HANDSHAKE_SUBTITLE =
  "Waiting for the other person — retrying if they switched devices.";

export const QUEUED_STANDBY_SUBTITLE =
  "Not receiving on this device — tap Receive on this device to continue.";

export const STANDBY_COMPOSER_NOTICE =
  "This device isn't receiving new chats. Receive on this device to start this conversation.";

/** Standby devices must not start a handshake: the published marker is another device's (or an orphan). */
export function isStandbyNewChatBlocked(
  receiverRole: string | null | undefined,
  linkStatus: string | null | undefined,
): boolean {
  return receiverRole === "standby" && linkStatus !== "established";
}

/**
 * The only formatter that may produce outbound message status words.
 * Storage may still hold `delivered` / `read`; those fold into Sent until
 * CHAT_RECEIPT_KIND ships.
 */
export function formatDeliveryStatus(
  state: LinkDeliveryState | string,
): DeliveryStatusLabel {
  switch (state) {
    case "sending":
      return "Queued";
    case "failed":
      return "Failed";
    case "sent":
    case "delivered":
    case "read":
      return "Sent";
    default:
      return "Queued";
  }
}

export function queuedThreadSubtitle(input: {
  linkStatus?: string | null;
  lastDeliveryState?: string | null;
  receiverRole?: string | null;
}): string | null {
  if (input.linkStatus === "established") return null;
  if (input.lastDeliveryState === "sent" || input.lastDeliveryState === "delivered") return null;
  if (input.linkStatus === "handshaking" || input.lastDeliveryState === "sending") {
    if (input.receiverRole === "standby") return QUEUED_STANDBY_SUBTITLE;
    return QUEUED_HANDSHAKE_SUBTITLE;
  }
  return null;
}

export function isFailedDelivery(state: LinkDeliveryState | string): boolean {
  return state === "failed";
}
