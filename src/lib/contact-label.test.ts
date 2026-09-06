import { describe, expect, it } from "vitest";
import { contactPrimaryLabel, normalizeNickname } from "./contact-label";

describe("nicknames", () => {
  it("rejects pubky-shaped nicknames and keeps a real secondary name", () => {
    const pubky = "a".repeat(52);
    expect(normalizeNickname(pubky)).toBeNull();
    const labels = contactPrimaryLabel({ nickname: "Star", displayName: "Aster Example", pubky });
    expect(labels.primary).toContain("Star");
    expect(labels.secondary).toContain("Aster");
  });
});
