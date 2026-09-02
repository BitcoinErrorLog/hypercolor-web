import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "thread-view.tsx"),
  "utf8",
);

describe("thread origin hydration", () => {
  it("reads sessionStorage through useSyncExternalStore with a null server snapshot", () => {
    expect(source).toContain("useSyncExternalStore");
    expect(source).toContain("peekThreadOrigin");
    expect(source).toContain("() => null");
    expect(source).not.toMatch(/const origin = peekThreadOrigin\(\)/);
  });
});
