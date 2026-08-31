import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "contacts-page.tsx"),
  "utf8",
);

describe("contacts username search copy", () => {
  it("says a username is not an identity and search is skippable", () => {
    expect(source).toContain("data-testid=\"contactSearchIdentityCopy\"");
    expect(source).toContain("A username is not an identity");
    expect(source).toContain("paste a pubky");
    expect(source).toContain("addManualContact");
    expect(source).toContain("PubkyAnchors");
    expect(source).toContain("contactSearchLookalike");
    expect(source).toContain("key={ownerPubky ?? \"none\"}");
  });
});
