import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "composer.tsx"),
  "utf8",
);

describe("composer action menu", () => {
  it("uses the shared sheet with named attach actions", () => {
    expect(source).toContain("ModalSheet");
    expect(source).toContain('role="menu"');
    expect(source).toContain("Photo");
    expect(source).toContain("File");
    expect(source).toContain("Cancel");
    expect(source).toContain("IconPhoto");
    expect(source).toContain("IconFile");
    expect(source).toContain("AttachPhoto");
    expect(source).toContain("AttachFile");
    expect(source).toContain("AttachCancel");
  });
});
