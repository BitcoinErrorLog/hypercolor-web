/** Match playwright.config `localBase` / per-proof `PLAYWRIGHT_STAGING_PORT`. */
export function stagingBaseUrl(): string {
  const fromEnv = process.env.PLAYWRIGHT_BASE_URL?.trim();
  if (fromEnv) return fromEnv;
  const port =
    process.env.PLAYWRIGHT_STAGING_PORT ??
    process.env.PLAYWRIGHT_RING_PORT ??
    "3000";
  return `http://localhost:${port}`;
}
