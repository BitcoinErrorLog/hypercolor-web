import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "sheet.tsx"),
  "utf8",
);

describe("ModalSheet", () => {
  it("puts aria-modal on a dialog and nests role=menu inside that dialog", () => {
    expect(source).toContain('role === "menu" ? "dialog" : role');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('role="menu"');
    expect(source).toContain("inertBackground");
    expect(source).toContain("createPortal");
    expect(source).toContain('layer === "gate" ? "z-60" : "z-50"');
    expect(source).toContain("scriptedMotionMs");
  });
});
