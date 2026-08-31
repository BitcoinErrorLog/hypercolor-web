import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("chats route split", () => {
  it("owns /chats as a static page, not the optional catch-all", () => {
    const index = path.join(here, "../../../app/chats/page.tsx");
    const conversation = path.join(
      here,
      "../../../app/chats/[conversationId]/page.tsx",
    );
    expect(existsSync(index)).toBe(true);
    expect(existsSync(conversation)).toBe(true);
    expect(readFileSync(index, "utf8")).toContain("ChatsPageHost");
    expect(readFileSync(conversation, "utf8")).toContain("generateStaticParams");
  });

  it("opens a thread with pushAppPath instead of a document navigation", () => {
    const source = readFileSync(path.join(here, "chatsPageHost.tsx"), "utf8");
    expect(source).toContain("pushAppPath");
    expect(source).not.toContain("location.assign");
    expect(source).not.toContain("router.push");
  });
});
