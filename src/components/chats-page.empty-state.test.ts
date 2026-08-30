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
    expect(source).toContain("No conversations yet.");
  });

  it("has empty-state guidance copy", () => {
    expect(source).toMatch(
      /Start a new chat from the field above|Search for a contact to start chatting/,
    );
  });
});
