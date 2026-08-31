import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "follows-import-panel.tsx"),
  "utf8",
);
const importer = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../services/contacts/followsImport.ts"),
  "utf8",
);

describe("follows import presentation", () => {
  it("requires an explicit understand-and-enable action and states the public-follow cost", () => {
    const text = source.replace(/\s+/g, " ");
    expect(source).toContain("data-testid=\"followsImportUnderstand\"");
    expect(source).toContain("data-testid=\"followsImportEnable\"");
    expect(text).toContain("world-readable");
    expect(text).toContain("will not write a follow");
    expect(text).toContain("accepted automatically");
    expect(text).toContain("Use my pubky.app follows to recognise people");
  });

  it("does not write follows from the importer", () => {
    expect(importer).not.toContain("putPublic");
    expect(importer).not.toContain("deletePublic");
    expect(importer).not.toMatch(/follows\/\$\{/);
  });
});
