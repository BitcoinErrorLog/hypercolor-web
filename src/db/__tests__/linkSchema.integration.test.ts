/**
 * Exercises the REAL migration SQL (v1–v13) against in-memory SQLite via
 * better-sqlite3. Official sqlite3 wasm cannot run under vitest; this
 * adapter runs the identical SQL strings (see betterSqliteAdapter.ts).
 *
 * StorageService statement cases live in src/services/StorageService.test.ts
 * (real KeyStore + fake-indexeddb). Schema/migration cases stay here.
 */
import { afterEach, describe, expect, it } from "vitest";
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
} from "../schema";
import { CHAT_MESSAGE_KIND } from "../../types/link";
import { openMemoryDb } from "./betterSqliteAdapter";

const OWNER = "a".repeat(52);
const PEER = "z".repeat(52);
const OTHER = "b".repeat(52);
const EVENT = "00000000-0000-4000-8000-000000000001";

function applyV3(db: ReturnType<typeof openMemoryDb>): void {
  for (const statement of [
    ...SCHEMA_V1_STATEMENTS,
    ...SCHEMA_V2_STATEMENTS,
    ...SCHEMA_V3_STATEMENTS,
  ]) {
    db.executeSync(statement);
  }
  db.executeSync("PRAGMA user_version = 3");
}

function seedV3LinkRows(db: ReturnType<typeof openMemoryDb>): void {
  db.executeSync(
    `INSERT INTO links (peer_pubky, role, status, snapshot, created_at, updated_at)
     VALUES (?, 'initiator', 'established', 'opaque-cipher', 1, 1)`,
    [PEER],
  );
  db.executeSync(
    `INSERT INTO link_messages
      (event_id, conversation_id, peer_pubky, direction, kind, raw_json,
       body, sent_at, received_at, delivery_state, created_at, updated_at)
     VALUES (?, ?, ?, 'received', ?, '{}', 'hi', 10, 11, 'delivered', 1, 1)`,
    [EVENT, `dm:${PEER}`, PEER, CHAT_MESSAGE_KIND],
  );
  db.executeSync(
    `INSERT INTO link_read_cursors (conversation_id, last_read_at, updated_at)
     VALUES (?, 10, 1)`,
    [`dm:${PEER}`],
  );
}

function applyThroughV5(db: ReturnType<typeof openMemoryDb>): void {
  for (const statement of [
    ...SCHEMA_V1_STATEMENTS,
    ...SCHEMA_V2_STATEMENTS,
    ...SCHEMA_V3_STATEMENTS,
    ...SCHEMA_V4_STATEMENTS,
    ...SCHEMA_V5_STATEMENTS,
  ]) {
    db.executeSync(statement);
  }
  db.executeSync("PRAGMA user_version = 5");
}

function applyThroughV7(db: ReturnType<typeof openMemoryDb>): void {
  applyThroughV5(db);
  for (const statement of [...SCHEMA_V6_STATEMENTS, ...SCHEMA_V7_STATEMENTS]) {
    db.executeSync(statement);
  }
  db.executeSync("PRAGMA user_version = 7");
}

function applyThroughV12(db: ReturnType<typeof openMemoryDb>): void {
  applyThroughV7(db);
  for (const statement of [
    ...SCHEMA_V8_STATEMENTS,
    ...SCHEMA_V9_STATEMENTS,
    ...SCHEMA_V10_STATEMENTS,
    ...SCHEMA_V11_STATEMENTS,
    ...SCHEMA_V12_STATEMENTS,
  ]) {
    db.executeSync(statement);
  }
  db.executeSync("PRAGMA user_version = 12");
}

function tableExists(db: ReturnType<typeof openMemoryDb>, name: string): number {
  return (
    db.executeSync(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [name],
    ).rows?.length ?? 0
  );
}

describe("link schema v13 (real SQL via better-sqlite3)", () => {
  afterEach(() => {
    setDbForTests(null);
  });

  it("enforces foreign_keys like production getDb()", () => {
    const db = openMemoryDb();
    db.executeSync("PRAGMA journal_mode = WAL");
    db.executeSync("PRAGMA foreign_keys = ON");
    expect(db.executeSync("PRAGMA foreign_keys").rows?.[0]?.foreign_keys).toBe(
      1,
    );
  });

  it("reaches current user_version from a fresh database", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);
    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(
      CURRENT_VERSION,
    );
  });

  it("does not copy v3 secret_ref as a receiver alias (force re-provision)", async () => {
    const db = openMemoryDb();
    applyV3(db);
    db.executeSync(
      `INSERT INTO link_receivers
        (owner_pubky, secret_ref, app, runtime, marker_published, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, 1)`,
      [OWNER, "hypercolor-link-receiver-secret", "hypercolor", "mobile"],
    );
    seedV3LinkRows(db);

    await runMigrations(db);

    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(
      CURRENT_VERSION,
    );
    expect(db.executeSync("SELECT * FROM link_receivers").rows).toEqual([]);
    expect(tableExists(db, "link_receivers")).toBe(1);

    const link = db.executeSync("SELECT * FROM links").rows?.[0];
    expect(link).toEqual(
      expect.objectContaining({
        owner_pubky: OWNER,
        peer_pubky: PEER,
        snapshot: "opaque-cipher",
        local_receiver_path: "hypercolor/wallet",
        consecutive_failures: 0,
      }),
    );
    expect(db.executeSync("SELECT * FROM link_messages").rows?.[0]).toEqual(
      expect.objectContaining({
        owner_pubky: OWNER,
        sender_pubky: PEER,
        kind: CHAT_MESSAGE_KIND,
        event_id: EVENT,
      }),
    );
    expect(db.executeSync("SELECT * FROM link_read_cursors").rows?.[0]).toEqual(
      expect.objectContaining({
        owner_pubky: OWNER,
        conversation_id: `dm:${PEER}`,
      }),
    );
    expect(tableExists(db, "link_stream_items")).toBe(1);
  });

  it("does not leave empty-owner rows when v3 has no receiver", async () => {
    const db = openMemoryDb();
    applyV3(db);
    seedV3LinkRows(db);

    await runMigrations(db);

    expect(db.executeSync("SELECT * FROM link_receivers").rows).toEqual([]);
    expect(db.executeSync("SELECT * FROM links").rows).toEqual([]);
    expect(db.executeSync("SELECT * FROM link_messages").rows).toEqual([]);
    expect(db.executeSync("SELECT * FROM link_read_cursors").rows).toEqual([]);
    expect(
      db.executeSync("SELECT COUNT(*) AS n FROM links WHERE owner_pubky = ''")
        .rows?.[0]?.n,
    ).toBe(0);
    expect(
      db.executeSync(
        "SELECT COUNT(*) AS n FROM link_messages WHERE owner_pubky = ''",
      ).rows?.[0]?.n,
    ).toBe(0);
    expect(
      db.executeSync(
        "SELECT COUNT(*) AS n FROM link_read_cursors WHERE owner_pubky = ''",
      ).rows?.[0]?.n,
    ).toBe(0);
  });

  it("applies v5 contact relationship columns and message_requests", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(
      CURRENT_VERSION,
    );
    const cols = db.executeSync("PRAGMA table_info(contacts)").rows ?? [];
    const names = cols.map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "owner_pubky",
        "is_following",
        "is_follower",
        "is_mutual",
        "added_manually",
      ]),
    );
    expect(tableExists(db, "message_requests")).toBe(1);
    const pkCols = cols.filter((row) => Number(row.pk) > 0).map((row) => row.name);
    expect(pkCols).toEqual(["owner_pubky", "pubky"]);
  });

  it("backfills empty-owner contacts to the sole receiver and drops ambiguous orphans", async () => {
    const sole = openMemoryDb();
    applyThroughV5(sole);
    sole.executeSync(
      `INSERT INTO link_receivers
        (owner_pubky, receiver_alias, receiver_path, marker_published, created_at, updated_at)
       VALUES (?, 'alias', 'hypercolor/wallet', 1, 1, 1)`,
      [OWNER],
    );
    sole.executeSync(
      `INSERT INTO contacts
        (pubky, owner_pubky, display_name, trust_score, is_following, is_follower,
         is_mutual, added_manually, first_seen_at, created_at, updated_at)
       VALUES (?, '', 'Orphan', 1.0, 0, 1, 0, 0, 1, 1, 1)`,
      [PEER],
    );
    await runMigrations(sole);
    expect(
      sole.executeSync("SELECT owner_pubky, trust_score FROM contacts").rows?.[0],
    ).toEqual(expect.objectContaining({ owner_pubky: OWNER, trust_score: 1.0 }));

    const ambiguous = openMemoryDb();
    applyThroughV5(ambiguous);
    ambiguous.executeSync(
      `INSERT INTO link_receivers
        (owner_pubky, receiver_alias, receiver_path, marker_published, created_at, updated_at)
       VALUES (?, 'a', 'hypercolor/wallet', 1, 1, 1)`,
      [OWNER],
    );
    ambiguous.executeSync(
      `INSERT INTO link_receivers
        (owner_pubky, receiver_alias, receiver_path, marker_published, created_at, updated_at)
       VALUES (?, 'b', 'hypercolor/wallet', 1, 1, 1)`,
      [OTHER],
    );
    ambiguous.executeSync(
      `INSERT INTO contacts
        (pubky, owner_pubky, display_name, trust_score, is_following, is_follower,
         is_mutual, added_manually, first_seen_at, created_at, updated_at)
       VALUES (?, '', 'Shared', 1.0, 0, 1, 0, 0, 1, 1, 1)`,
      [PEER],
    );
    await runMigrations(ambiguous);
    expect(ambiguous.executeSync("SELECT * FROM contacts").rows).toEqual([]);
  });

  it("v13 drops research-era tables, keeps delivery_queue, and adds reply_to_author_pubky", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    applyThroughV12(db);
    db.executeSync(
      `INSERT INTO threads
        (id, participant_pubky, unread_count, created_at, updated_at)
       VALUES ('t1', ?, 0, 1, 1)`,
      [PEER],
    );
    expect(db.executeSync("SELECT id FROM threads").rows?.[0]?.id).toBe("t1");

    await runMigrations(db);

    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(
      CURRENT_VERSION,
    );
    for (const name of [
      "threads",
      "messages",
      "channels",
      "channel_members",
      "cursor_state",
    ]) {
      expect(tableExists(db, name)).toBe(0);
    }
    expect(tableExists(db, "delivery_queue")).toBe(1);
    expect(tableExists(db, "mesh_peers")).toBe(1);
    const groupCols = (
      db.executeSync("PRAGMA table_info(group_messages)").rows ?? []
    ).map((row) => row.name);
    expect(groupCols).toEqual(expect.arrayContaining(["reply_to_author_pubky"]));
  });

  it("creates v8 group tables with sender-scoped primary key", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(
      CURRENT_VERSION,
    );
    for (const name of [
      "group_channels",
      "group_members",
      "group_messages",
      "group_seen_events",
      "group_deferred_events",
    ]) {
      expect(tableExists(db, name)).toBe(1);
    }
    const pk = db.executeSync("PRAGMA table_info(group_messages)").rows ?? [];
    const pkCols = pk.filter((row) => Number(row.pk) > 0).map((row) => row.name);
    expect(pkCols).toEqual([
      "owner_pubky",
      "channel_id",
      "sender_pubky",
      "event_id",
    ]);
    expect(pk.map((row) => row.name)).toEqual(
      expect.arrayContaining(["target_author_pubky"]),
    );
  });

  it("migrates v7 group_messages into the sender-scoped v8 primary key", async () => {
    const db = openMemoryDb();
    applyThroughV7(db);
    db.executeSync(
      `INSERT INTO group_messages
        (owner_pubky, channel_id, event_id, sender_pubky, kind, body, raw_json,
         sent_at, received_at, delivery_state, reply_to_event_id, target_event_id,
         edited_at, deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'hi', '{}', 10, NULL, 'sent', NULL, NULL, NULL, 0, 1, 1)`,
      [OWNER, "chan-1", EVENT, PEER, CHAT_MESSAGE_KIND],
    );

    await runMigrations(db);

    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(
      CURRENT_VERSION,
    );
    const row = db.executeSync("SELECT * FROM group_messages").rows?.[0];
    expect(row).toEqual(
      expect.objectContaining({
        owner_pubky: OWNER,
        channel_id: "chan-1",
        sender_pubky: PEER,
        event_id: EVENT,
        target_author_pubky: null,
        body: "hi",
      }),
    );
    const pk = db.executeSync("PRAGMA table_info(group_messages)").rows ?? [];
    expect(
      pk.filter((col) => Number(col.pk) > 0).map((col) => col.name),
    ).toEqual(["owner_pubky", "channel_id", "sender_pubky", "event_id"]);
  });

  it("creates v9/v10 attachments with sender-scoped primary key", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(
      CURRENT_VERSION,
    );
    expect(tableExists(db, "attachments")).toBe(1);
    expect(tableExists(db, "pending_cleanup")).toBe(1);
    const pk = db.executeSync("PRAGMA table_info(attachments)").rows ?? [];
    expect(pk.filter((col) => Number(col.pk) > 0).map((col) => col.name)).toEqual(
      ["owner_pubky", "sender_pubky", "event_id"],
    );
    expect(pk.map((col) => col.name)).toEqual(
      expect.arrayContaining([
        "conversation_id",
        "channel_id",
        "location",
        "key_ref",
        "content_type",
        "size",
        "thumbnail_location",
        "local_cache_path",
        "delivery_state",
        "resolve_state",
      ]),
    );
  });

  it("adds the owner-scoped DM tombstone column", async () => {
    const db = openMemoryDb();
    await runMigrations(db);

    const columns = (db.executeSync("PRAGMA table_info(link_messages)").rows ?? []).map(
      (column) => column.name,
    );
    expect(columns).toContain("deleted");
    expect(
      db.executeSync("SELECT deleted FROM link_messages").rows ?? [],
    ).toEqual([]);
  });

  it("creates v11 payment tables with owner-scoped primary key", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(
      CURRENT_VERSION,
    );
    const paymentCols = (
      db.executeSync("PRAGMA table_info(payment_requests)").rows ?? []
    ).map((col) => col.name);
    expect(paymentCols).toEqual(
      expect.arrayContaining([
        "pending_event_id",
        "displayed_payment_hash",
        "proof_verified",
      ]),
    );
    expect(tableExists(db, "payment_requests")).toBe(1);
    expect(tableExists(db, "payment_events")).toBe(1);
    expect(tableExists(db, "tip_endpoints")).toBe(1);
    const pk = db.executeSync("PRAGMA table_info(payment_requests)").rows ?? [];
    expect(pk.filter((col) => Number(col.pk) > 0).map((col) => col.name)).toEqual(
      ["owner_pubky", "peer_pubky", "payment_request_id"],
    );
  });
});
