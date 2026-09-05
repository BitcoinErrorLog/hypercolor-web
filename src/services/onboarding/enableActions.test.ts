import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "enableActions.tsx"),
  "utf8",
);

describe("enable offline retry", () => {
  it("retries session restore instead of navigating to /enable", () => {
    expect(source).toContain("retrySessionRestore");
    expect(source).toContain("retryBusy");
    expect(source).toContain("offline");
    expect(source).toContain("tryAdoptPendingHandoffForSession");
  });
});
