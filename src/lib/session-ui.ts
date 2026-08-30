import type { SessionUiStatus } from "@/stores/sessionStatusStore";

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

export function sessionStatusLabel(status: SessionUiStatus): string {
  switch (status.kind) {
    case "unknown":
      return "Checking session…";
    case "no-identity":
      return "Not connected";
    case "needs-enable":
      return "Identity adopted — enable messaging";
    case "session-offline":
      return "Session offline";
    case "live":
      return "Session live — publish a receiver";
    case "enabled":
      return "Encrypted messaging enabled";
  }
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
