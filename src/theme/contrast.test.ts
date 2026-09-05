import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";
import { CONTRAST_PAIRINGS } from "./tokens";

describe("theme contrast pairings", () => {
  it("meets WCAG AA for every introduced pairing", () => {
    const lines: string[] = [];
    for (const pairing of CONTRAST_PAIRINGS) {
      const ratio = contrastRatio(pairing.foreground, pairing.background);
      const rounded = Math.round(ratio * 100) / 100;
      const line = `${pairing.name}: ${rounded.toFixed(2)}:1 (min ${pairing.minRatio}:1)`;
      lines.push(line);
      expect(ratio, line).toBeGreaterThanOrEqual(pairing.minRatio);
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  });

  it("rejects a deliberately failing pairing", () => {
    const ratio = contrastRatio("#7c3aed", "#4c1d95");
    expect(ratio).toBeLessThan(3);
  });
});
