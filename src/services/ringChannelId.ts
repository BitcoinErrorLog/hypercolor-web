import { base64urlnopad } from "@scure/base";
export { formatRingVerificationCode } from "../lib/ring-verification-code";

/** Domain-separated prefix so Hypercolor channels never collide with pubkyauth. */
export const RING_CALLBACK_CHANNEL_CONTEXT = "hypercolor-web/ring-callback/v1";

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
