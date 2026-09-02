import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "chats-page.tsx"),
  "utf8",
);

describe("chats-page empty state", () => {
  it("keeps the empty-state heading and test id", () => {
    expect(source).toContain('data-testid="chatsEmpty"');
    expect(source).toContain("No chats yet.");
  });

  it("keeps control copy as the default empty-state hint", () => {
    expect(source).toContain("Add someone by pubky, then start a chat.");
    expect(source).toContain("emptyStateHint");
    expect(source).toContain("{emptyStateHint}");
  });

  it("owns the Mode A candidate empty-state hint for the host to pass", () => {
    expect(source).toContain("Try the search field above to start a chat.");
  });

  it("pins Message requests above the list", () => {
    expect(source).toContain("Message requests");
    expect(source).toContain('data-testid="chatsRequests"');
  });

  it("does not fetch assignment or import vibeware", () => {
    expect(source).not.toContain("vibeware");
    expect(source).not.toMatch(/\bfetch\b/);
    expect(source).not.toContain("fetchAssignment");
  });
});
