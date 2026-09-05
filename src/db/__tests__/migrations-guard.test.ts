import { describe, expect, it } from "vitest";
import { applyMigrationStatement, runMigrations } from "../migrations";
import { openMemoryDb } from "./betterSqliteAdapter";
import { SCHEMA_V13_STATEMENTS } from "../schema";

describe("idempotent migration guards", () => {
  it("skips ADD COLUMN when pragma table_info already lists the column", async () => {
    const db = openMemoryDb();
    await runMigrations(db);
    applyMigrationStatement(db, SCHEMA_V13_STATEMENTS[SCHEMA_V13_STATEMENTS.length - 1]!);
    expect(db.executeSync("PRAGMA table_info(group_messages)").rows?.some((r) => r.name === "reply_to_author_pubky")).toBe(
      true,
    );
  });

  it("unguarded ALTER replay still fails (negative)", async () => {
    const db = openMemoryDb();
    await runMigrations(db);
    db.executeSync("PRAGMA user_version = 12");
    await expect(runMigrations(db, { allowUnguardedAlter: true })).rejects.toThrow(
      /Migration v13 failed:.*duplicate column name: reply_to_author_pubky/i,
    );
  });
});
