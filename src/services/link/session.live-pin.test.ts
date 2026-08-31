import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "session.ts"),
  "utf8",
);

describe("session live handle Fast Refresh pin", () => {
  it("writes the adopted session through bindLive on globalThis", () => {
    expect(source).toContain('const LIVE_KEY = "__hypercolorLiveSession"');
    expect(source).toContain("function bindLive");
    expect(source).toContain("bindLive({ pubky, handle })");
    expect(source).toContain("bindLive(null)");
    expect(source).not.toMatch(/^let live: LiveSession \| null = null;/m);
  });
});
