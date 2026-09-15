import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "error-details.tsx"),
  "utf8",
);
const banner = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "session-banner.tsx"),
  "utf8",
);

describe("live regions", () => {
  it("lets load errors opt into role=status without a doubled aria-live", () => {
    expect(source).toContain('live = "alert"');
    expect(source).toContain('live?: "alert" | "status"');
    expect(source).toContain('live === "status" ? "status" : "alert"');
    expect(source).not.toContain("<details>");
    expect(banner).toContain('role="status"');
    expect(banner).not.toContain("aria-live");
  });
});
