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
    expect(text).toContain("never writes a follow");
    expect(text).not.toContain("accepted automatically");
    expect(text).toContain("never auto-accept a message");
    expect(text).toContain("Use my follows");
    expect(text).toContain("opening Contacts re-reads that listing");
    expect(text).toContain("never asks Nexus who follows you");
    expect(text).toContain("Imported suggestions were cleared");
    expect(source).toContain("clearImportedRelationshipFlags");
    expect(source).toContain("importGeneration");
  });

  it("does not write follows from the importer", () => {
    expect(importer).not.toContain("putPublic");
    expect(importer).not.toContain("deletePublic");
    expect(importer).not.toMatch(/follows\/\$\{/);
  });
});
