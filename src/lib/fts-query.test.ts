import { describe, expect, it } from "vitest";
import { likePattern, sanitizeFtsQuery } from "./fts-query";

describe("fts query sanitise", () => {
  it("strips MATCH operators", () => {
    expect(sanitizeFtsQuery('hello" OR 1=1 --')).toBe('"hello" AND "or" AND "1" AND "1"');
    expect(likePattern("%_;drop")).toBe("%drop%");
  });
});
