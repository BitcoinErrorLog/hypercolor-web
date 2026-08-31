import { describe, expect, it } from "vitest";
import { nameHasLookalikeCharacters } from "./confusable-name";

describe("nameHasLookalikeCharacters", () => {
  it("accepts a single-script Latin name matching a Latin query", () => {
    expect(nameHasLookalikeCharacters("Ada", "ada")).toBe(false);
    expect(nameHasLookalikeCharacters("José", "jose")).toBe(false);
  });

  it("flags mixed Latin and Cyrillic in the name", () => {
    expect(nameHasLookalikeCharacters("аda", "ada")).toBe(true);
  });

  it("flags a Cyrillic name against a Latin query", () => {
    expect(nameHasLookalikeCharacters("ада", "ada")).toBe(true);
  });

  it("does not flag ordinary Japanese as mixed-script", () => {
    expect(nameHasLookalikeCharacters("山田太郎")).toBe(false);
  });
});
