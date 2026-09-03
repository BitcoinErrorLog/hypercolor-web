import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const DEFAULT_SYMBOLS = [
  "UX catalog",
  "data-vrt-scene",
  "thread-populated",
  "profile-sign-out",
  "contact-detail-populated",
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return [path];
  });
}

export function scanOutForCatalogSymbols(outDir, symbols = DEFAULT_SYMBOLS) {
  return walk(outDir).flatMap((file) => {
    if (!file.includes(join("_next", "static", "chunks"))) return [];
    if (!/\.(?:js|css)$/.test(file)) return [];
    const body = readFileSync(file, "utf8");
    return symbols.flatMap((symbol) =>
      body.includes(symbol) ? [`${relative(outDir, file)}: ${symbol}`] : [],
    );
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? "out";
  const hits = scanOutForCatalogSymbols(outDir);
  if (hits.length > 0) {
    console.error(`Catalog symbols found in ${outDir}:`);
    for (const hit of hits) console.error(`- ${hit}`);
    process.exit(1);
  }
  console.log(`Catalog absent from ${outDir}: 0 hits`);
}
