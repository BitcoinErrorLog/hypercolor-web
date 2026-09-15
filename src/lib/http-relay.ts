/** Production httprelay link base (pubky SDK DEFAULT_HTTP_RELAY). */
export const DEFAULT_HTTP_RELAY = "https://httprelay.pubky.app/link";

export function getHttpRelayBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_HTTP_RELAY;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/+$/, "");
  }
  return DEFAULT_HTTP_RELAY;
}
