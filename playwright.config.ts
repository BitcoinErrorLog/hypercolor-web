import { defineConfig } from "@playwright/test";

const useStaticPreview = process.env.PLAYWRIGHT_STATIC === "1";
const staticUrl = "http://127.0.0.1:3300";
const devUrl = "http://localhost:3000";

/**
 * Browser e2e against `next dev` (default) or the rewrite-aware static export.
 *
 * Production preview (no harness hooks):
 *
 *   npm run build
 *   npm run preview:static
 *
 * Recovery-gate static proof (self-contained). Rebuilds into `out-e2e/` with
 * `NEXT_PUBLIC_E2E_HARNESS=1` and a `.e2e-harness` marker from an isolated
 * tree; production `out/` and `.next/` are not touched. CI must use this
 * command:
 *
 *   npm run test:e2e:static
 *
 * `preview:static` serves `out/` and refuses a tree that contains `.e2e-harness`
 * or live `__hypercolor*` harness hook symbols. Do not point it at `out-e2e/`
 * without `--allow-e2e-harness`.
 *
 * Manual harness preview:
 *
 *   npm run build:e2e:static
 *   npm run preview:static -- --port 3300 --root out-e2e --allow-e2e-harness
 */
export default defineConfig({
  testDir: "./e2e",
  testIgnore: /\._/,
  fullyParallel: true,
  snapshotPathTemplate: "e2e/vrt-baselines/{projectName}/{testFilePath}/{arg}{ext}",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? (useStaticPreview ? staticUrl : devUrl),
    trace: "on-first-retry",
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
    deviceScaleFactor: 1,
  },
  projects: [
    {
      name: "chromium",
      testIgnore: [/ux-catalog\.spec\.ts/, /\._/],
    },
    {
      name: "chromium-mobile-pixel",
      testMatch: /ux-catalog\.spec\.ts/,
      testIgnore: /\._/,
      use: {
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "chromium-desktop-pixel",
      testMatch: /ux-catalog\.spec\.ts/,
      testIgnore: /\._/,
      use: {
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : useStaticPreview
      ? {
          command: "npm run preview:static -- --port 3300 --root out-e2e --allow-e2e-harness",
          url: staticUrl,
          reuseExistingServer: false,
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
