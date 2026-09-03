import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const globalsPath = join(root, "app/globals.css");
const globals = readFileSync(globalsPath, "utf8");

const WCAG_AA_BODY = 4.5;
const WCAG_AA_UI_LARGE = 3;

const textOnSurfacePairs = [
  ["textPrimary/canvas", "--color-textPrimary", "--color-canvas", "body"],
  ["textPrimary/surface", "--color-textPrimary", "--color-surface", "body"],
  ["textPrimary/surfaceRaised", "--color-textPrimary", "--color-surfaceRaised", "body"],
  ["textPrimary/surfaceBrand", "--color-textPrimary", "--color-surfaceBrand", "body"],
  ["textPrimary/bubbleIncoming", "--color-textPrimary", "--color-bubbleIncoming", "body"],
  ["textSecondary/canvas", "--color-textSecondary", "--color-canvas", "body"],
  ["textSecondary/surface", "--color-textSecondary", "--color-surface", "body"],
  ["textSecondary/surfaceRaised", "--color-textSecondary", "--color-surfaceRaised", "body"],
  ["textSecondary/surfaceBrand", "--color-textSecondary", "--color-surfaceBrand", "body"],
  ["textSecondary/bubbleIncoming", "--color-textSecondary", "--color-bubbleIncoming", "body"],
  ["textMuted/canvas", "--color-textMuted", "--color-canvas", "body"],
  ["textMuted/surface", "--color-textMuted", "--color-surface", "body"],
  ["textMuted/surfaceRaised", "--color-textMuted", "--color-surfaceRaised", "body"],
  ["textMuted/surfaceBrand", "--color-textMuted", "--color-surfaceBrand", "body"],
  ["textMuted/bubbleIncoming", "--color-textMuted", "--color-bubbleIncoming", "body"],
  ["textOnBrand/brand", "--color-textOnBrand", "--color-brand", "body"],
  ["onBrandMuted/brand", "--color-onBrandMuted", "--color-brand", "body"],
  ["textOnBrandMuted/brand", "--color-textOnBrandMuted", "--color-brand", "body"],
  ["textOnBrandUi/brand", "--color-textOnBrandUi", "--color-brand", "ui-large"],
  ["dangerButton/default", "--color-onDanger", "--color-dangerSurface", "body"],
  ["dangerButton/hover", "--color-onDanger", "--color-dangerSurfacePressed", "body"],
  ["brandText/canvas", "--color-brandText", "--color-canvas", "body"],
  ["brandMuted/canvas", "--color-brandMuted", "--color-canvas", "body"],
  ["brandSoft/canvas", "--color-brandSoft", "--color-canvas", "body"],
  ["brandHighlight/canvas", "--color-brandHighlight", "--color-canvas", "body"],
  ["brand/canvas", "--color-brand", "--color-canvas", "ui-large"],
  ["danger/canvas", "--color-danger", "--color-canvas", "body"],
  ["danger/surface", "--color-danger", "--color-surface", "body"],
  ["dangerStrong/canvas", "--color-dangerStrong", "--color-canvas", "body"],
  ["warning/canvas", "--color-warning", "--color-canvas", "body"],
  ["warningStrong/canvas", "--color-warningStrong", "--color-canvas", "body"],
  ["success/canvas", "--color-success", "--color-canvas", "body"],
  ["qrModules/qrQuietZone", "--color-qrModules", "--color-qrQuietZone", "body"],
];

function cssVariables(css) {
  const vars = new Map();
  for (const match of css.matchAll(/(--[A-Za-z0-9-]+):\s*([^;]+);/g)) {
    vars.set(match[1], match[2].trim());
  }
  return vars;
}

function resolveVar(vars, name, seen = new Set()) {
  const value = vars.get(name);
  if (!value) throw new Error(`Missing CSS variable ${name}`);
  const ref = value.match(/^var\((--[A-Za-z0-9-]+)\)$/);
  if (!ref) return value;
  if (seen.has(name)) throw new Error(`CSS variable cycle at ${name}`);
  seen.add(name);
  return resolveVar(vars, ref[1], seen);
}

function parseCssColor(input) {
  const trimmed = input.trim();
  const hex = trimmed.match(/^#([0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const body = hex[1];
    return {
      r: Number.parseInt(body.slice(0, 2), 16),
      g: Number.parseInt(body.slice(2, 4), 16),
      b: Number.parseInt(body.slice(4, 6), 16),
      a: body.length === 8 ? Number.parseInt(body.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgba = trimmed.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/);
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  throw new Error(`Unsupported color ${input}`);
}

function compositeOver(fg, bg) {
  const a = fg.a + bg.a * (1 - fg.a);
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a,
  };
}

function linear(channel) {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(color) {
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

function contrast(foreground, background) {
  const bg = parseCssColor(background);
  const fg = compositeOver(parseCssColor(foreground), bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

function walk(dir) {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) return walk(path);
      return [path];
    });
}

describe("web design tokens", () => {
  it("meets WCAG AA for every approved text-on-surface pair", () => {
    const vars = cssVariables(globals);
    const failures = textOnSurfacePairs.flatMap(([name, fgVar, bgVar, usage]) => {
      const ratio = contrast(resolveVar(vars, fgVar), resolveVar(vars, bgVar));
      const threshold = usage === "body" ? WCAG_AA_BODY : WCAG_AA_UI_LARGE;
      return ratio >= threshold ? [] : [`${name} ${ratio.toFixed(2)} < ${threshold}`];
    });
    expect(failures).toEqual([]);
  });

  it("keeps raw style literals out of app and component code", () => {
    const files = [...walk(join(root, "app")), ...walk(join(root, "src/components"))]
      .filter((file) => /\.(?:ts|tsx|css)$/.test(file))
      .filter((file) => file !== globalsPath);
    const raw = /#[0-9a-fA-F]{3,8}|rgba?\(|(?:^|[\s"`])(?:text-red|text-amber|text-white|bg-white|bg-brand|text-brand|bg-red|bg-green|bg-yellow|border-white|bg-\[|text-\[|h-8|h-9|w-9|min-h-\[|min-w-\[|max-w-\[|p[xy]?-\[|m[xy]?-\[|gap-\[|rounded-\[)/;
    const failures = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => raw.test(line) ? [`${relative(root, file)}:${index + 1}: ${line.trim()}`] : []),
    );
    expect(failures).toEqual([]);
  });
});
