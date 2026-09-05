import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ALLOWED_CLASSES = [
  "hc-header-iridescent",
  "hc-avatar-ring",
  "hc-brand-cta",
  "hc-hero-iridescent",
  "hc-boot-iridescent",
] as const;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("._") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(tsx|ts|css)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function classAt(source: string, index: number): string | null {
  const before = source.slice(0, index);
  const match = before.match(/\.([a-z0-9-]+)\s*\{[^}]*$/);
  return match?.[1] ?? null;
}

describe("iridescence confinement", () => {
  it("uses --brand-iridescent only inside the five allowed class names", () => {
    const files = [
      path.join(ROOT, "app/globals.css"),
      ...walk(path.join(ROOT, "src/design")),
      ...walk(path.join(ROOT, "src/components/shell")),
      ...walk(path.join(ROOT, "src/components/ui")),
      ...walk(path.join(ROOT, "app/design")),
    ];
    const hits: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      let cursor = 0;
      while (cursor < source.length) {
        const at = source.indexOf("--brand-iridescent", cursor);
        if (at < 0) break;
        const rel = path.relative(ROOT, file);
        if (rel === "app/globals.css") {
          const cls = classAt(source, at);
          const prefix = source.slice(0, at);
          const inRoot = /:root\s*\{[^}]*$/.test(prefix) || prefix.lastIndexOf(":root") > prefix.lastIndexOf("@theme");
          const inTheme = prefix.lastIndexOf("@theme") > prefix.lastIndexOf(".hc-");
          if (inRoot || inTheme) {
            cursor = at + 18;
            continue;
          }
          if (!cls || !ALLOWED_CLASSES.includes(cls as (typeof ALLOWED_CLASSES)[number])) {
            hits.push(`${rel}:${cls ?? "unknown"}`);
          }
        } else {
          hits.push(`${rel}:direct`);
        }
        cursor = at + 18;
      }
    }
    process.stdout.write(
      `allowed classes: ${ALLOWED_CLASSES.join(", ")}\n` +
        `offending --brand-iridescent sites: ${hits.length ? hits.join(", ") : "none"}\n`,
    );
    expect(hits).toEqual([]);
  });
});
