import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pixelmatch from "pixelmatch";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { UX_CATALOG_SCENES } from "@/components/ux-catalog/scenes";

test.describe.configure({ mode: "serial" });

const repoRoot = join(__dirname, "..");

function snapshotDir(projectName: string) {
  return join(repoRoot, "e2e/vrt-baselines", projectName, "ux-catalog.spec.ts");
}

function listPngs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".png") && !name.startsWith("._"))
    .map((name) => join(dir, name))
    .sort();
}

async function readPng(path: string) {
  const image = sharp(readFileSync(path));
  const metadata = await image.metadata();
  const data = await image.ensureAlpha().raw().toBuffer();
  return {
    data,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}

test.afterAll(async ({}, testInfo) => {
  const dir = snapshotDir(testInfo.project.name);
  const files = listPngs(dir);
  const failures: string[] = [];
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const a = await readPng(files[i]);
      const b = await readPng(files[j]);
      if (a.width !== b.width || a.height !== b.height) continue;
      const diff = pixelmatch(a.data, b.data, new Uint8Array(a.width * a.height * 4), a.width, a.height, {
        threshold: 0.1,
        includeAA: false,
      });
      const identical = 1 - diff / (a.width * a.height);
      if (identical >= 0.99) {
        failures.push(`${files[i]} and ${files[j]} are ${(identical * 100).toFixed(2)}% identical`);
      }
    }
  }
  expect(failures).toEqual([]);
  console.log(`VRT integrity ${testInfo.project.name}: ${files.length} PNGs checked, 0 >=99% duplicates`);
});

for (const scene of UX_CATALOG_SCENES) {
  test(`${scene.journey} / ${scene.surface} / ${scene.state}`, async ({ page }) => {
    await page.goto(`/e2e/ux-catalog?scene=${scene.id}`);
    const marker = page.locator(`[data-vrt-scene="${scene.id}"]`);
    await expect(marker).toBeVisible();
    await expect(marker).toHaveScreenshot(`${scene.id}.png`, {
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
