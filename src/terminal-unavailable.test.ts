import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const productRouteFiles = [
  "app/page.tsx",
  "app/not-found.tsx",
];

describe("terminal unavailable surface", () => {
  it("has no product bootstrap or session imports", () => {
    const source = readFileSync(resolve(root, "app/layout.tsx"), "utf8");
    expect(source).not.toMatch(/Session|Paykit|wasm|fetch|indexedDB|localStorage/);
  });

  it("renders the unavailable surface for the retained routes", () => {
    for (const file of productRouteFiles) {
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source).toContain("UnavailablePage");
      expect(source).not.toMatch(/SiteNav|Session|Paykit|wasm|fetch/);
    }
  });
});
