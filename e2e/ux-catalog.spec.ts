import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { UX_CATALOG_SCENES } from "@/components/ux-catalog/scenes";
import { findNearDuplicatePngs, listPngs } from "../scripts/ux-vrt-integrity.mjs";

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
  console.log(`VRT integrity ${testInfo.project.name}: ${files.length} PNGs checked, 0 >=99% duplicates`);
});

for (const scene of UX_CATALOG_SCENES) {
  test(`${scene.journey} / ${scene.surface} / ${scene.state}`, async ({ page }) => {
    await page.goto(`/e2e/ux-catalog?scene=${scene.id}`);
    const marker = page.locator(`[data-vrt-scene="${scene.id}"]`);
    await expect(marker).toBeVisible();
    const portalSurface = marker.locator("[data-vrt-portal-root] [data-surface]").first();
    const surface = scene.surface === "sign-out" || scene.surface === "composer-menu"
      ? portalSurface
      : marker.locator("[data-surface]").first();
    await expect(surface).toBeVisible();
    await surface.screenshot({
      path: test.info().snapshotPath(`${scene.id}.png`),
      animations: "disabled",
      mask: [
        page.getByTestId("welcomeQr"),
        page.getByTestId("enableMessagingQr"),
        page.getByTestId("recoveryCode"),
      ],
    });
  });
}
