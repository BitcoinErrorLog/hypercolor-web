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
const chatsOpen = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/chats-open.ts"),
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
    expect(host).toMatch(/\{enabled \?\s*\([\s\S]*<ChatsPageHost \/>/);
    expect(host).toContain("setChatsOpen(true)");
    expect(host).toContain("markChatsRequested()");
    expect(host).toContain("isChatsRequested()");
    expect(host).toContain("showOpenChats={enabled && !chatsVisible}");
    expect(host).toContain("setError(err instanceof Error ? err.message : \"Authorization failed\")");
    expect(host).toContain("useEnableCompleted");
    expect(host).toContain("status.kind === \"enabled\" || enableDone");
    expect(host).toContain('"use no memo"');
    expect(host).toContain("flushSync");
    expect(host).toContain("markEnableCompleted(result.pubky)");
    expect(host).toContain("setEnabled(result.pubky)");
    expect(host).toContain("inert: true");
    expect(host).toContain("stampAppPath(\"/chats\")");
    expect(source).toContain("showOpenChats");
    expect(host).not.toContain("setTimeout");
    expect(host).not.toContain("pushAppPath");
    expect(host).not.toContain("router.push");
    expect(host).not.toContain("location.assign");
    expect(chatsOpen).toContain("sessionStorage");
    expect(chatsOpen).toContain("chatsRequested");
    expect(pathId).toContain("export function stampAppPath");
    expect(pathId).toContain("__NA: true");
  });
});
