import { defineConfig } from "@playwright/test";

/**
 * Browser e2e is a later wave. This config is enough to run a static-home
 * smoke against `next dev` or a served `out/` directory:
 *
 *   npm run build && npx serve out -p 3000
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
 *
 * Ring proof (`RUN_STAGING_RING=1`) starts its own unharnessed server on
 * 3010 so it never inherits `NEXT_PUBLIC_E2E_HARNESS` from a leftover :3000.
 */
const ringProof = process.env.RUN_STAGING_RING === "1";
const ringPort = process.env.PLAYWRIGHT_RING_PORT ?? "3010";
const localBase = ringProof ? `http://localhost:${ringPort}` : "http://localhost:3000";

function processEnvRecord(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const webServerEnv = processEnvRecord();
webServerEnv.COPYFILE_DISABLE = "1";
if (ringProof) {
  delete webServerEnv.NEXT_PUBLIC_E2E_HARNESS;
  webServerEnv.NEXT_PUBLIC_APP_ORIGIN = `http://localhost:${ringPort}`;
} else {
  webServerEnv.NEXT_PUBLIC_E2E_HARNESS = "1";
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? localBase,
    trace: "on-first-retry",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: ringProof
          ? `rm -rf .next && npm run dev -- --port ${ringPort}`
          : `rm -rf .next && npm run dev -- --port 3000`,
        url: localBase,
        reuseExistingServer: ringProof ? false : !process.env.CI,
        timeout: 120_000,
        env: webServerEnv,
      },
});
