export type WelcomePhase = "idle" | "waiting" | "finishing" | "ready" | "failed" | "expired";

export function resolveWelcomePhase(input: {
  isExpired: boolean;
  error: string | null;
  pendingPubky: string | null;
  linkLive: boolean;
  finishing?: boolean;
  phase?: WelcomePhase;
}): WelcomePhase {
  if (input.phase) return input.phase;
  if (input.isExpired) return "expired";
  if (input.pendingPubky) return "ready";
  if (input.finishing) return "finishing";
  if (input.error) return "failed";
  if (input.linkLive) return "waiting";
  return "idle";
}
