/**
 * W1b regression guard: open a DB frozen at each historical schema version,
 * run current migrations, then exercise StorageService list/count/get/upsert.
 *
 * Snapshots are built by applying SCHEMA_V1..VN SQL from the current tree
 * (web schema has been CURRENT_VERSION=13 since the first commit that added
 * these files). Official sqlite3 wasm cannot run under vitest; better-sqlite3
 * executes the identical SQL strings.
 */
import { afterEach, describe, expect, it } from "vitest";
import { StorageService } from "../../services/StorageService";
import { setDbForTests } from "../index";
import { CURRENT_VERSION, runMigrations } from "../migrations";
import {
  SCHEMA_V1_STATEMENTS,
  SCHEMA_V2_STATEMENTS,
  SCHEMA_V3_STATEMENTS,
  SCHEMA_V4_STATEMENTS,
  SCHEMA_V5_STATEMENTS,
  SCHEMA_V6_STATEMENTS,
  SCHEMA_V7_STATEMENTS,
  SCHEMA_V8_STATEMENTS,
  SCHEMA_V9_STATEMENTS,
  SCHEMA_V10_STATEMENTS,
  SCHEMA_V11_STATEMENTS,
  SCHEMA_V12_STATEMENTS,
  SCHEMA_V13_STATEMENTS,
  SCHEMA_V14_STATEMENTS,
  SCHEMA_V15_STATEMENTS,
  SCHEMA_V16_STATEMENTS,
  SCHEMA_V17_STATEMENTS,
} from "../schema";
import { openMemoryDb } from "./betterSqliteAdapter";

const OWNER = "a".repeat(52);
const PEER = "z".repeat(52);

const BY_VERSION: readonly (readonly string[])[] = [
  SCHEMA_V1_STATEMENTS,
  SCHEMA_V2_STATEMENTS,
  SCHEMA_V3_STATEMENTS,
  SCHEMA_V4_STATEMENTS,
  SCHEMA_V5_STATEMENTS,
  SCHEMA_V6_STATEMENTS,
  SCHEMA_V7_STATEMENTS,
  SCHEMA_V8_STATEMENTS,
  SCHEMA_V9_STATEMENTS,
  SCHEMA_V10_STATEMENTS,
  SCHEMA_V11_STATEMENTS,
  SCHEMA_V12_STATEMENTS,
  SCHEMA_V13_STATEMENTS,
  SCHEMA_V14_STATEMENTS,
  SCHEMA_V15_STATEMENTS,
  SCHEMA_V16_STATEMENTS,
  SCHEMA_V17_STATEMENTS,
];

function applyThrough(version: number): ReturnType<typeof openMemoryDb> {
  const db = openMemoryDb();
  for (let v = 1; v <= version; v += 1) {
    for (const statement of BY_VERSION[v - 1] ?? []) {
      db.executeSync(statement);
    }
  }
  if (version > 0) {
    db.executeSync(`PRAGMA user_version = ${version}`);
  }
  return db;
}

async function exerciseStorage(db: ReturnType<typeof openMemoryDb>): Promise<void> {
  setDbForTests(db);
  await runMigrations(db);
  expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(CURRENT_VERSION);
  const linkCols = (db.executeSync("PRAGMA table_info(links)").rows ?? []).map((row) =>
    String(row.name),
  );
  expect(linkCols).toContain("chat_kinds_v");

  await expect(StorageService.listLinkConversations(OWNER)).resolves.toEqual([]);
  await expect(StorageService.countPendingMessageRequests(OWNER)).resolves.toBe(0);
  await expect(StorageService.getContact(PEER, OWNER)).resolves.toBeNull();
  await StorageService.upsertContact({
    pubky: PEER,
    ownerPubky: OWNER,
    displayName: "Zed",
    trustScore: 0,
    isFollowing: false,
    isFollower: false,
    isMutual: false,
    addedManually: true,
    firstSeenAt: 1,
  });
  await expect(StorageService.getContact(PEER, OWNER)).resolves.toEqual(
    expect.objectContaining({
      pubky: PEER,
      ownerPubky: OWNER,
      displayName: "Zed",
      addedManually: true,
    }),
  );
}

describe("upgrade matrix: historical schema → current migrations → StorageService", () => {
  afterEach(() => {
    setDbForTests(null);
  });

  it("upgrades from empty (user_version 0)", async () => {
    await exerciseStorage(openMemoryDb());
  });

  for (let version = 1; version <= 17; version += 1) {
    it(`upgrades from frozen schema v${version}`, async () => {
      await exerciseStorage(applyThrough(version));
    });
  }

  it("replays v14 ALTER when receiver_role already exists (idempotent ADD COLUMN)", async () => {
    const db = applyThrough(13);
    db.executeSync("ALTER TABLE link_receivers ADD COLUMN receiver_role TEXT NOT NULL DEFAULT 'active'");
    db.executeSync("PRAGMA user_version = 13");
    await exerciseStorage(db);
  });

  it("replays v13 ALTER when the column already exists (idempotent ADD COLUMN)", async () => {
    const db = applyThrough(12);
    db.executeSync("ALTER TABLE group_messages ADD COLUMN reply_to_author_pubky TEXT");
    db.executeSync("PRAGMA user_version = 12");
    await exerciseStorage(db);
  });

  it("replays v12 ALTER when pending_event_id already exists (idempotent ADD COLUMN)", async () => {
    const db = applyThrough(11);
    db.executeSync("ALTER TABLE payment_requests ADD COLUMN pending_event_id TEXT");
    db.executeSync("PRAGMA user_version = 11");
    await exerciseStorage(db);
  });
});
