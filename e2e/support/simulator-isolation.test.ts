import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function walkTs(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith("._")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkTs(path)));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe("ring simulator isolation", () => {
  it("is not imported from src/", async () => {
    const files = await walkTs(join(process.cwd(), "src"));
    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (
        text.includes("e2e/support") ||
        text.includes("ring-simulator") ||
        text.includes("sb2EncryptSigned")
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not keep the hand-rolled SB2 stack", async () => {
    expect(await exists(join(process.cwd(), "e2e/support/sb2.ts"))).toBe(false);
    expect(await exists(join(process.cwd(), "e2e/support/vendor/noble-hashes"))).toBe(false);
    expect(await exists(join(process.cwd(), "e2e/support/ensure-ring-deps.mjs"))).toBe(false);
  });
});
