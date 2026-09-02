import type { LinkDeliveryState } from "@/types/link";

export type DeliveryStatusLabel = "Queued" | "Sent" | "Failed";

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
      return "Sent";
  }
}

export function isFailedDelivery(state: LinkDeliveryState | string): boolean {
  return state === "failed";
}
