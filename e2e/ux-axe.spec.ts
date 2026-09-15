import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { UX_CATALOG_SCENES } from "@/components/ux-catalog/scenes";

/**
 * Per-scene axe rule disables. Each entry must name a documented false positive.
 * Never disable a rule across all scenes.
 */
const AXE_RULE_DISABLES: Partial<Record<string, { id: string; reason: string }[]>> = {};

test.describe("catalog axe WCAG 2.1 A/AA", () => {
  for (const scene of UX_CATALOG_SCENES) {
    test(`${scene.id}`, async ({ page }) => {
      await page.goto(`/e2e/ux-catalog?scene=${scene.id}`);
      const marker = page.locator(`[data-vrt-scene="${scene.id}"]`);
      await expect(marker).toBeAttached({ timeout: 30_000 });

      const disables = AXE_RULE_DISABLES[scene.id] ?? [];
      let builder = new AxeBuilder({ page })
        .include(`[data-vrt-scene="${scene.id}"]`)
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
      for (const rule of disables) {
        builder = builder.disableRules(rule.id);
      }

      const results = await builder.analyze();
      const blocking = results.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      );
      const report = blocking
        .map((violation) => {
          const nodes = violation.nodes
            .map((node) => `${node.target.join(" ")}: ${node.failureSummary ?? node.html}`)
            .join("\n    ");
          return `${violation.id} [${violation.impact}] ${violation.help}\n    ${nodes}`;
        })
        .join("\n");
      expect(blocking, report).toEqual([]);
    });
  }
});
