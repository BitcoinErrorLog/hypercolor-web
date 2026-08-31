import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("chats route split", () => {
  it("uses optional catch-all with empty conversationId static param", () => {
    const page = path.join(
      here,
      "../../../app/chats/[[...conversationId]]/page.tsx",
    );
    expect(existsSync(page)).toBe(true);
    const source = readFileSync(page, "utf8");
    expect(source).toContain("ChatsPageHost");
    expect(source).toContain("generateStaticParams");
    expect(source).toContain("conversationId: []");
  });

  it("opens a thread with pushAppPath instead of a document navigation", () => {
    const source = readFileSync(path.join(here, "chatsPageHost.tsx"), "utf8");
    expect(source).toContain("pushAppPath");
    expect(source).not.toContain("location.assign");
    expect(source).not.toContain("router.push");
  });
});
