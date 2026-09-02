import { defineConfig } from "@playwright/test";

/**
 * Browser e2e is a later wave. This config is enough to run a static-home
 * smoke against `next dev` or a served `out/` directory:
 *
 *   npm run build && npx serve out -p 3000
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  testIgnore: /\._/,
  fullyParallel: true,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --port 3000",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          NEXT_PUBLIC_E2E_HARNESS: "1",
        },
      },
});
