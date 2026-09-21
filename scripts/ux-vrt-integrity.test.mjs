import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { compareImages, findBlankPngs, findNearDuplicatePngs, listPngs } from "./ux-vrt-integrity.mjs";

let tempDirs = [];

async function png(path, width, height, rgba) {
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: rgba,
    },
  }).png().toFile(path);
}

describe("ux VRT integrity gate", () => {
  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs = [];
  });

  it("fails two scene entries pointing at identical pixels", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hc-vrt-"));
    tempDirs.push(dir);
    const a = join(dir, "thread-populated.png");
    const b = join(dir, "thread-duplicate.png");
    await png(a, 16, 16, { r: 17, g: 17, b: 17, alpha: 1 });
    await png(b, 16, 16, { r: 17, g: 17, b: 17, alpha: 1 });
    await expect(findNearDuplicatePngs([a, b])).resolves.toEqual([
      "thread-populated.png and thread-duplicate.png are 100.00% identical",
    ]);
  });

  it("compares mismatched sizes by shared content plus size penalty", () => {
    const pixel = new Uint8Array(4 * 4 * 4).fill(255);
    const larger = new Uint8Array(4 * 5 * 4).fill(255);
    const result = compareImages(
      { data: pixel, width: 4, height: 4 },
      { data: larger, width: 4, height: 5 },
    );
    expect(result.sizeMismatch).toBe(true);
    expect(result.identity).toBeCloseTo(0.8, 4);
  });

  it("fails a uniform black capture as a blank frame", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hc-vrt-blank-"));
    tempDirs.push(dir);
    const blank = join(dir, "chrome-nav-no-identity.png");
    await png(blank, 16, 16, { r: 11, g: 11, b: 11, alpha: 1 });
    await expect(findBlankPngs([blank])).resolves.toEqual([
      expect.stringMatching(/chrome-nav-no-identity\.png is \d+ bytes \(blank-frame floor is 800\)/),
    ]);
  });

  it("keeps committed catalog baselines free of unwaived near-duplicates", async () => {
    const root = new URL("..", import.meta.url).pathname;
    const projects = ["chromium-mobile-pixel", "chromium-desktop-pixel"];
    const failures = (
      await Promise.all(projects.map((project) =>
        findNearDuplicatePngs(listPngs(join(root, "e2e/vrt-baselines", project, "ux-catalog.spec.ts"))),
      ))
    ).flat();
    expect(failures).toEqual([]);
    const blanks = (
      await Promise.all(projects.map((project) =>
        findBlankPngs(listPngs(join(root, "e2e/vrt-baselines", project, "ux-catalog.spec.ts"))),
      ))
    ).flat();
    expect(blanks).toEqual([]);
    // Pairwise identity over 86+86 catalog PNGs measured 366s on this machine (2026-09-05).
  }, 600_000);
});
