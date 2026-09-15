import { AttachmentError } from "@/types/attachment";
import { toLinkNativeError } from "@/services/link/PaykitLinkWeb";
import { emit } from "./collector";

export const COARSE_SURFACES = [
  "chats",
  "thread",
  "channel",
  "welcome",
  "enable",
  "requests",
  "settings",
  "contacts",
  "attachment",
] as const;

export type CoarseSurface = (typeof COARSE_SURFACES)[number];

export function coarseCodeFromError(err: unknown): string {
  if (err instanceof AttachmentError) return err.code;
  return toLinkNativeError(err).code;
}

export function emitCoarseError(surface: CoarseSurface, err: unknown): void {
  void emit("app.error.coarse", { code: coarseCodeFromError(err), surface });
}

export function sendOutcomeFromDelivery(
  state: string,
): "sent" | "failed" | "queued" | null {
  if (state === "sent" || state === "delivered" || state === "read") return "sent";
  if (state === "sending") return "queued";
  if (state === "failed") return "failed";
  return null;
}

export function onboardingStateFromKind(
  kind: string,
): "no-identity" | "needs-enable" | "session-offline" | "live" | null {
  if (kind === "unknown") return null;
  if (kind === "enabled") return "live";
  if (
    kind === "no-identity" ||
    kind === "needs-enable" ||
    kind === "session-offline" ||
    kind === "live"
  ) {
    return kind;
  }
  return null;
}
