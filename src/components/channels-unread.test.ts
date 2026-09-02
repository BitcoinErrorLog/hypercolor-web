import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = path.dirname(fileURLToPath(import.meta.url));
const channels = readFileSync(path.join(dir, "channels-page.tsx"), "utf8");
const nav = readFileSync(path.join(dir, "site-nav.tsx"), "utf8");
const chats = readFileSync(path.join(dir, "chats-page.tsx"), "utf8");

describe("channel unread surfaces", () => {
  it("shows unread counts on private rows and the Channels nav badge", () => {
    expect(channels).toContain('data-testid="channelUnread"');
    expect(channels).toContain("row.unreadCount");
    expect(nav).toContain("totalChannelUnread");
    expect(nav).toContain('testId="channelsNavBadge"');
    expect(nav).toContain('testId="chatsNavBadge"');
  });
});

describe("offline compose gating", () => {
  it("lets session-offline start a chat", () => {
    expect(chats).toContain("canComposeMessages");
    expect(chats).not.toContain("composeEnabled = isMessagingEnabled");
  });
});
