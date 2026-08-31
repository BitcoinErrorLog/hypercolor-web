import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "enable-page.tsx"),
  "utf8",
);
const host = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../services/onboarding/enableActions.tsx",
  ),
  "utf8",
);
const pathId = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/path-id.ts"),
  "utf8",
);

describe("enable-page Open chats", () => {
  it("opens chats in the live Enable module and stamps __NA so Next does not start Flight", () => {
    expect(source).toContain('type="button"');
    expect(source).toContain("onOpenChats");
    expect(source).not.toContain("<Link");
    expect(source).not.toContain("location.assign");
    expect(source).not.toContain("router.push");
    expect(host).toContain("ChatsPageHost");
    expect(host).toContain("setChatsOpen(true)");
    expect(host).toContain("setTimeout");
    expect(host).toContain("pushAppPath(\"/chats\")");
    expect(host).toContain("[chatsOpen]");
    expect(host).not.toContain("router.push");
    expect(pathId).toContain("__NA: true");
  });
});
