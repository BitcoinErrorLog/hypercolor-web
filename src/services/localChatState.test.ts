import { afterEach, describe, expect, it } from "vitest";
import { setDbForTests } from "../db";
import { runMigrations } from "../db/migrations";
import { openMemoryDb } from "../db/__tests__/betterSqliteAdapter";
import { LocalChatState, indexDecryptedMessage } from "./localChatState";

const OWNER = "a".repeat(52);
const PEER = "b".repeat(52);

describe("local chat state", () => {
  afterEach(() => {
    setDbForTests(null);
  });

  it("stores nicknames, mute flags, and LIKE search", async () => {
    const db = openMemoryDb();
    await runMigrations(db);
    setDbForTests(db);
    await LocalChatState.setNickname(OWNER, PEER, "Star");
    await expect(LocalChatState.getNickname(OWNER, PEER)).resolves.toBe("Star");
    await LocalChatState.setThreadFlags(OWNER, "dm:x", { muted: true, archived: true });
    await expect(LocalChatState.getThreadFlags(OWNER, "dm:x")).resolves.toMatchObject({
      muted: true,
      archived: true,
    });
    indexDecryptedMessage(db, {
      ownerPubky: OWNER,
      threadKey: "dm:x",
      eventId: "11111111-1111-4111-8111-111111111111",
      senderPubky: PEER,
      body: "Secret hello world",
      sentAt: 1,
    });
    const hits = await LocalChatState.searchMessages(OWNER, "hello");
    expect(hits.some((hit) => hit.bodyNorm.includes("hello"))).toBe(true);
  });
});
