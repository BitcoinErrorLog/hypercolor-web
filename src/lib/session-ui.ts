import type { SessionUiStatus } from "@/stores/sessionStatusStore";
import { RING_GRANT_CAPABILITIES } from "@/types/link";

/** Canonical custody line. Screens that must show it use this string verbatim. */
export const CUSTODY_LINE =
  "Pubky Ring holds your key. Hypercolor never sees it.";

/** Distinct from CUSTODY_LINE — a recovery code is a Hypercolor-generated secret. */
export const BACKUP_CUSTODY_LINE =
  "This code unlocks your local backup. It is not your identity key — Pubky Ring still holds that.";

export const SCOPE_SENTENCE =
  "Approve the Paykit and Hypercolor write scopes in Pubky Ring.";

export const LEGACY_RING_LINE =
  "Update Pubky Ring, or approve once more";

export const RING_GRANT_DETAIL = RING_GRANT_CAPABILITIES;

export const PUBLIC_GRAPH_WARNING =
  "Public — anything you post here is world-readable and permanent. Loading this list asks the public index for topics; the index operator sees that query. Your chats and private groups are never sent here.";

export const PUBLIC_SUBSTRATE_LINE =
  "Public topics here are tags on the public Pubky graph.";

export const OFFLINE_BANNER_LABEL =
  "You are offline. Messages will send when you reconnect.";

export type SessionPrimaryAction = "navigate" | "retry" | "none";

export type SessionCopy = {
  label: string;
  body: string | null;
  primary: string;
  primaryHref: string | null;
  primaryAction: SessionPrimaryAction;
  secondary: string | null;
};

const COPY: Record<SessionUiStatus["kind"], SessionCopy> = {
  unknown: {
    label: "Checking session…",
    body: null,
    primary: "",
    primaryHref: null,
    primaryAction: "none",
    secondary: null,
  },
  "no-identity": {
    label: "Not connected",
    body: CUSTODY_LINE,
    primary: "Connect with Pubky Ring",
    primaryHref: "/",
    primaryAction: "navigate",
    secondary: null,
  },
  "needs-enable": {
    label: "Messaging not enabled",
    body: SCOPE_SENTENCE,
    primary: "Enable encrypted messaging",
    primaryHref: "/enable",
    primaryAction: "navigate",
    secondary: "Not now",
  },
  "session-offline": {
    label: OFFLINE_BANNER_LABEL,
    body: null,
    primary: "Try again",
    primaryHref: null,
    primaryAction: "retry",
    secondary: null,
  },
  live: {
    label: "Messaging not enabled",
    body: SCOPE_SENTENCE,
    primary: "Enable encrypted messaging",
    primaryHref: "/enable",
    primaryAction: "navigate",
    secondary: "Not now",
  },
  enabled: {
    label: "Encrypted messaging enabled",
    body: "Ring approved the grant and this device published a receiver marker.",
    primary: "Open chats",
    primaryHref: "/chats",
    primaryAction: "navigate",
    secondary: "Authorize again",
  },
};

export function sessionCopy(status: SessionUiStatus): SessionCopy {
  return COPY[status.kind];
}

export function hasIdentity(status: SessionUiStatus): boolean {
  return (
    status.kind === "needs-enable" ||
    status.kind === "session-offline" ||
    status.kind === "live" ||
    status.kind === "enabled"
  );
}

export function isMessagingEnabled(status: SessionUiStatus): boolean {
  return status.kind === "enabled";
}

/** Offline sends stay in the composer and queue as Queued. Needs-enable does not. */
export function canComposeMessages(status: SessionUiStatus): boolean {
  return status.kind === "enabled" || status.kind === "session-offline";
}

export function sessionStatusLabel(status: SessionUiStatus): string {
  return sessionCopy(status).label;
}

export function sessionPubky(status: SessionUiStatus): string | null {
  if (
    status.kind === "session-offline" ||
    status.kind === "live" ||
    status.kind === "enabled"
  ) {
    return status.pubky;
  }
  return null;
}

export function sessionCtaLabel(status: SessionUiStatus): string {
  return sessionCopy(status).primary;
}
