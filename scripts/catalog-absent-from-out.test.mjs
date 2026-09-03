import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanOutForCatalogSymbols } from "./catalog-absent-from-out.mjs";

let dirs = [];

describe("catalog production bundle scan", () => {
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });

  it("reports catalog scene strings in static output chunks", () => {
    const dir = join(tmpdir(), `hc-out-${Date.now()}`);
    dirs.push(dir);
    mkdirSync(join(dir, "_next/static/chunks"), { recursive: true });
    writeFileSync(join(dir, "_next/static/chunks/page.js"), "const scene='thread-populated';");
    expect(scanOutForCatalogSymbols(dir)).toEqual(["_next/static/chunks/page.js: thread-populated"]);
  });

  it("passes normal production output text", () => {
    const dir = join(tmpdir(), `hc-out-${Date.now()}-clean`);
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), "<main>Hypercolor</main>");
    expect(scanOutForCatalogSymbols(dir)).toEqual([]);
  });
});
