import { describe, expect, it } from "vitest";
import { applyMigrationStatement, runMigrations } from "../migrations";
import { openMemoryDb } from "./betterSqliteAdapter";
import { SCHEMA_V13_STATEMENTS, SCHEMA_V14_STATEMENTS } from "../schema";

describe("idempotent migration guards", () => {
  it("skips ADD COLUMN when pragma table_info already lists the column", async () => {
    const db = openMemoryDb();
    await runMigrations(db);
    applyMigrationStatement(db, SCHEMA_V14_STATEMENTS[0]!);
    expect(db.executeSync("PRAGMA table_info(link_receivers)").rows?.some((r) => r.name === "receiver_role")).toBe(
      true,
    );
  });

  it("unguarded ALTER replay still fails (negative)", async () => {
    const db = openMemoryDb();
    await runMigrations(db);
    db.executeSync("PRAGMA user_version = 13");
    await expect(runMigrations(db, { allowUnguardedAlter: true })).rejects.toThrow(
      /Migration v14 failed:.*duplicate column name: receiver_role/i,
    );
  });
});
