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
 *
 * Staging harness proofs each bind a dedicated port (3000–3004) and shadow
 * app dir (`/tmp/hypercolor-ringsim-app-${port}`) so parallel npm runs do
 * not rmSync or compile over each other.
 */
const ringProof = process.env.RUN_STAGING_RING === "1";
const stagingPort =
  process.env.PLAYWRIGHT_STAGING_PORT ??
  (ringProof ? (process.env.PLAYWRIGHT_RING_PORT ?? "3010") : "3000");
const ringPort = process.env.PLAYWRIGHT_RING_PORT ?? "3010";
const localBase = ringProof
  ? `http://localhost:${ringPort}`
  : `http://localhost:${stagingPort}`;
const RUN_NEXT = "node e2e/support/run-next-local.mjs";

function processEnvRecord(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const vercelBypass = process.env.VERCEL_PROTECTION_BYPASS?.trim();
const bypassHeaders = vercelBypass
  ? {
      "x-vercel-protection-bypass": vercelBypass,
      "x-vercel-set-bypass-cookie": "true",
    }
  : undefined;

const webServerEnv = processEnvRecord();
webServerEnv.COPYFILE_DISABLE = "1";
delete webServerEnv.NEXT_DIST_DIR;
if (ringProof) {
  delete webServerEnv.NEXT_PUBLIC_E2E_HARNESS;
  webServerEnv.NEXT_PUBLIC_APP_ORIGIN = `http://localhost:${ringPort}`;
  webServerEnv.PLAYWRIGHT_RING_PORT = ringPort;
} else {
  webServerEnv.NEXT_PUBLIC_E2E_HARNESS = "1";
  webServerEnv.PLAYWRIGHT_STAGING_PORT = stagingPort;
  webServerEnv.NEXT_PUBLIC_APP_ORIGIN = `http://localhost:${stagingPort}`;
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? localBase,
    trace: "on-first-retry",
    extraHTTPHeaders: bypassHeaders,
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: ringProof
          ? `rm -rf /tmp/hypercolor-ringsim-app-${ringPort} /tmp/hypercolor-ringsim-next && PLAYWRIGHT_RING_PORT=${ringPort} ${RUN_NEXT} --port ${ringPort}`
          : `rm -rf /tmp/hypercolor-ringsim-app-${stagingPort} /tmp/hypercolor-ringsim-next && PLAYWRIGHT_STAGING_PORT=${stagingPort} ${RUN_NEXT} --port ${stagingPort}`,
        url: localBase,
        reuseExistingServer: ringProof ? false : !process.env.CI,
        timeout: 120_000,
        env: webServerEnv,
      },
});
