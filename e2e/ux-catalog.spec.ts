import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { UX_CATALOG_SCENES } from "@/components/ux-catalog/scenes";
import { findNearDuplicatePngs, IDENTITY_ALLOWLIST, listPngs } from "../scripts/ux-vrt-integrity.mjs";

test.describe.configure({ mode: "serial" });

const repoRoot = join(__dirname, "..");
function snapshotDir(projectName: string) {
  return join(repoRoot, "e2e/vrt-baselines", projectName, "ux-catalog.spec.ts");
}

test.afterAll(async ({}, testInfo) => {
  const dir = snapshotDir(testInfo.project.name);
  const files = listPngs(dir);
  expect(files).toHaveLength(UX_CATALOG_SCENES.length);
  const failures = await findNearDuplicatePngs(files);
  expect(failures).toEqual([]);
  const waivers = [...IDENTITY_ALLOWLIST.entries()].map(([pair, rationale]) => `${pair}: ${rationale}`);
  console.log(`VRT integrity ${testInfo.project.name}: ${files.length} PNGs checked, 0 unwaived >=99% duplicates`);
  console.log(`VRT integrity waivers (${waivers.length}): ${waivers.join(" | ")}`);
});

for (const scene of UX_CATALOG_SCENES) {
  test(`${scene.journey} / ${scene.surface} / ${scene.state}`, async ({ page }) => {
    await page.goto(`/e2e/ux-catalog?scene=${scene.id}`);
    const marker = page.locator(`[data-vrt-scene="${scene.id}"]`);
    if (test.info().project.name === "chromium-mobile-pixel" && scene.surface === "nav") {
      await expect(marker).toHaveCount(1);
    } else {
      await expect(marker).toBeVisible();
    }
    const portalSurface = marker.locator(`[data-vrt-portal-root] [data-surface="${scene.expectedSurface}"]`).first();
    const surface = scene.surface === "sign-out" || scene.surface === "composer-menu"
      ? portalSurface
      : test.info().project.name === "chromium-mobile-pixel" && scene.surface === "nav"
        ? page.locator('[data-surface="site-nav-mobile"]').first()
        : marker.locator(`[data-surface="${scene.expectedSurface}"]`).first();
    await expect(surface).toBeVisible();
    if (scene.id === "welcome-qr-populated") {
      await expect(page.getByTestId("welcomeQr")).toBeVisible();
    }
    if (scene.id === "enable-waiting-qr") {
      await expect(page.getByTestId("enableMessagingQr")).toBeVisible();
    }
    await expect(surface).toHaveScreenshot(`${scene.id}.png`, {
      animations: "disabled",
      mask: [
        page.getByTestId("welcomeQr"),
        page.getByTestId("enableMessagingQr"),
        page.getByTestId("recoveryCode"),
      ],
      maxDiffPixelRatio: 0.001,
    });
  });
}
