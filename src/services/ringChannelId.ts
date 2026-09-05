import { base64urlnopad } from "@scure/base";

/** Domain-separated prefix so Hypercolor channels never collide with pubkyauth. */
export const RING_CALLBACK_CHANNEL_CONTEXT = "hypercolor-web/ring-callback/v1";

/**
 * First 6 characters of `ch`, grouped `XXX-XXX` — the same code Pubky Ring
 * shows before the user approves.
 */
export function formatRingVerificationCode(ch: string): string {
  const chars = ch.slice(0, 6);
  if (chars.length < 6) return chars;
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
}

/**
 * `ch = base64url_nopad(SHA-256("hypercolor-web/ring-callback/v1" || ephemeralPk_bytes))`
 */
export async function deriveRingCallbackChannelId(
  ephemeralPkBytes: Uint8Array,
): Promise<string> {
  const prefix = new TextEncoder().encode(RING_CALLBACK_CHANNEL_CONTEXT);
  const input = new Uint8Array(prefix.length + ephemeralPkBytes.length);
  input.set(prefix, 0);
  input.set(ephemeralPkBytes, prefix.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return base64urlnopad.encode(digest);
}
