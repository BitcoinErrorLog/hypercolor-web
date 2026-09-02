import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "requests-page.tsx"),
  "utf8",
);

describe("requests page contract states", () => {
  it("renders arrival time, invite copy, loading rows, and offline-disabled decisions", () => {
    expect(source).toContain('data-testid="requestArrived"');
    expect(source).toContain("formatRelativeTime(row.request.createdAt)");
    expect(source).toContain('data-testid="requestsLoading"');
    expect(source).toContain('data-testid="requestsInvite"');
    expect(source).toContain('data-testid="groupInvitation"');
    expect(source).toContain("offline = status.kind === \"session-offline\"");
    expect(source).toContain("decisionDisabled = busy || offline");
    expect(source).toContain("onRetry");
  });
});
