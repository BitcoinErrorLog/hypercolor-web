/**
 * Playwright-safe copies of Ring/handoff wire constants.
 * Do not import src/ modules that use the `@/` alias from Playwright (CJS).
 * Drift is gated by ring-wire.test.ts against the real src exports.
 */
import { getHttpRelayBase } from "../../src/lib/http-relay";

export const HANDOFF_TTL_MS = 5 * 60 * 1000;
export const HANDOFF_PATH_PREFIX = "/pub/paykit.app/v0/handoff/";
export const STAGING_HOMESERVER_Z32 =
  "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";
export const RELAY_CHANNEL_PREFIX = "hc-";

export { getHttpRelayBase };

export function relayChannelId(ch: string): string {
  if (!ch) {
    throw new Error("relayChannelId: channel digest is empty");
  }
  return ch.startsWith(RELAY_CHANNEL_PREFIX) ? ch : `${RELAY_CHANNEL_PREFIX}${ch}`;
}

export function relayChannelUrl(ch: string, base = getHttpRelayBase()): string {
  const normalized = base.replace(/\/+$/, "");
  return `${normalized}/${relayChannelId(ch)}`;
}
