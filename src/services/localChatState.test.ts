import { afterEach, describe, expect, it } from "vitest";
import { setDbForTests } from "../db";
import { runMigrations } from "../db/migrations";
import { openMemoryDb } from "../db/__tests__/betterSqliteAdapter";
import { LocalChatState, indexDecryptedMessage, removeSearchMessage } from "./localChatState";

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

  it("drops FTS plaintext on edit and tombstone", async () => {
    const db = openMemoryDb();
    await runMigrations(db);
    setDbForTests(db);
    indexDecryptedMessage(db, {
      ownerPubky: OWNER,
      threadKey: "dm:x",
      eventId: "11111111-1111-4111-8111-111111111111",
      senderPubky: PEER,
      body: "alpha secret token",
      sentAt: 1,
    });
    expect((await LocalChatState.searchMessages(OWNER, "alpha")).length).toBe(1);
    indexDecryptedMessage(db, {
      ownerPubky: OWNER,
      threadKey: "dm:x",
      eventId: "11111111-1111-4111-8111-111111111111",
      senderPubky: PEER,
      body: "beta public note",
      sentAt: 2,
    });
    expect((await LocalChatState.searchMessages(OWNER, "alpha")).length).toBe(0);
    expect((await LocalChatState.searchMessages(OWNER, "beta")).length).toBe(1);
    removeSearchMessage(db, OWNER, "dm:x", "11111111-1111-4111-8111-111111111111");
    expect((await LocalChatState.searchMessages(OWNER, "beta")).length).toBe(0);
    expect(db.executeSync("SELECT COUNT(*) AS n FROM message_search_fts").rows?.[0]?.n).toBe(0);
  });
});
