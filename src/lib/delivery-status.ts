import type { LinkDeliveryState } from "@/types/link";

export type DeliveryStatusLabel = "Queued" | "Sent" | "Delivered" | "Read" | "Failed";

export const QUEUED_HANDSHAKE_SUBTITLE =
  "Waiting for the other person — retrying if they switched devices.";

export const QUEUED_STANDBY_SUBTITLE =
  "Not receiving on this device — tap Receive on this device to continue.";

export const STANDBY_COMPOSER_NOTICE =
  "This device isn't receiving new chats. Receive on this device to start this conversation.";

export const CONNECTION_CHANGED_RETRY = "Connection changed — tap to retry";

/** Service/UI shared ready predicate: live established, `ready`, or established+snapshot. */
export function isUiLinkReady(
  linkStatus: string | null | undefined,
  extras?: { snapshot?: string | null; liveEstablished?: boolean; linkReady?: boolean },
): boolean {
  if (extras?.linkReady === true || extras?.liveEstablished) return true;
  if (linkStatus === "ready") return true;
  return linkStatus === "established" && (extras?.snapshot?.length ?? 0) > 0;
}

/** Standby devices must not start a handshake: the published marker is another device's (or an orphan). */
export function isStandbyNewChatBlocked(
  receiverRole: string | null | undefined,
  linkStatus: string | null | undefined,
  extras?: { snapshot?: string | null; liveEstablished?: boolean; linkReady?: boolean },
): boolean {
  return receiverRole === "standby" && !isUiLinkReady(linkStatus, extras);
}

/**
 * The only formatter that may produce outbound message status words.
 * Storage holds `delivered` / `read` after `chat.receipt.v0`.
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
      return "Sent";
    case "delivered":
      return "Delivered";
    case "read":
      return "Read";
    default:
      return "Queued";
  }
}

export function queuedThreadSubtitle(input: {
  linkStatus?: string | null;
  lastDeliveryState?: string | null;
  receiverRole?: string | null;
}): string | null {
  if (input.linkStatus === "established" || input.linkStatus === "ready") return null;
  if (input.linkStatus === "error") return CONNECTION_CHANGED_RETRY;
  if (input.lastDeliveryState === "sent" || input.lastDeliveryState === "delivered") return null;
  const handshake =
    input.linkStatus === "handshaking" ||
    input.linkStatus === "handshaking-initiator" ||
    input.linkStatus === "handshaking-responder" ||
    input.lastDeliveryState === "sending";
  if (handshake) {
    if (input.receiverRole === "standby") return QUEUED_STANDBY_SUBTITLE;
    return QUEUED_HANDSHAKE_SUBTITLE;
  }
  return null;
}

export function isFailedDelivery(state: LinkDeliveryState | string): boolean {
  return state === "failed";
}
