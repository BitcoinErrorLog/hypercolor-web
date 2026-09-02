import { defineConfig } from "@playwright/test";

const useStaticPreview = process.env.PLAYWRIGHT_STATIC === "1";
const staticUrl = "http://127.0.0.1:3300";
const devUrl = "http://localhost:3000";

/**
 * Browser e2e against `next dev` (default) or the rewrite-aware static export:
 *
 *   NEXT_PUBLIC_E2E_HARNESS=1 npm run build
 *   npm run preview:static
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
 *
 * If port 3000 is already taken:
 *
 *   PORT=3300 npm run preview:static
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3300 npx playwright test e2e/thread-origin.spec.ts e2e/recovery-gate.spec.ts
 *
 * Or, after `out/` exists: `npm run test:e2e:static` (serves `out/` with vercel.json rewrites on :3300).
 */
export default defineConfig({
  testDir: "./e2e",
  testIgnore: /\._/,
  fullyParallel: true,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? (useStaticPreview ? staticUrl : devUrl),
    trace: "on-first-retry",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : useStaticPreview
      ? {
          command: "npm run preview:static -- --port 3300",
          url: staticUrl,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        }
      : {
          command: "npm run dev -- --port 3000",
          url: devUrl,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            ...process.env,
            NEXT_PUBLIC_E2E_HARNESS: "1",
          },
        },
});
