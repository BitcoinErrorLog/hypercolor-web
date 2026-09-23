/** Intended production host. Overridable via NEXT_PUBLIC_APP_ORIGIN. */
export const DEFAULT_APP_ORIGIN = "https://hypercolor.app";

export function getAppOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/+$/, "");
  }
  return DEFAULT_APP_ORIGIN;
}
