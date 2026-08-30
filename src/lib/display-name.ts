import { formatPaymentDisplayText } from "@/utils/displaySanitize";

/** Contact and group names at render — existing displaySanitize, not raw storage. */
export function sanitizeDisplayName(raw: string): string {
  return formatPaymentDisplayText(raw);
}
