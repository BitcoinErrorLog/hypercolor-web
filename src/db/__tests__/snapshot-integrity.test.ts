import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteSnapshotIntegrityError } from "../errors";
import { CURRENT_VERSION, runMigrations } from "../migrations";
import { assertHydrateIntegrity, type SqliteSnapshotMeta } from "../openWebSqlite";
import { openMemoryDb } from "./betterSqliteAdapter";
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
} from "../schema";

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
];

function applyThrough(version: number) {
  const db = openMemoryDb();
  for (let v = 1; v <= version; v += 1) {
    for (const statement of BY_VERSION[v - 1] ?? []) {
      db.executeSync(statement);
    }
  }
  db.executeSync(`PRAGMA user_version = ${version}`);
  return db;
}

function oldFatalPredicate(
  meta: SqliteSnapshotMeta,
  blobVersion: number,
  sqliteBundleId: string,
): boolean {
  return meta.bundleId !== sqliteBundleId || meta.userVersion !== blobVersion;
}

describe("N1 hydrate integrity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("v13 snapshot + v14 bundleId hydrates and migrates (old OR predicate was fatal)", () => {
    const meta: SqliteSnapshotMeta = {
      userVersion: 13,
      bundleId: "hypercolor-web-schema-v13",
      generation: 1,
    };
    const blobVersion = 13;
    const sqliteBundleId = "hypercolor-web-schema-v14";
    const currentVersion = 14;

    expect(oldFatalPredicate(meta, blobVersion, sqliteBundleId)).toBe(true);

    const db = applyThrough(13);
    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(13);

    expect(() =>
      assertHydrateIntegrity(meta, blobVersion, { currentVersion, sqliteBundleId }),
    ).not.toThrow();

    const SCHEMA_V14 = ["ALTER TABLE contacts ADD COLUMN n1_bundle_upgrade INTEGER"];
    db.executeSync("BEGIN");
    for (const statement of SCHEMA_V14) db.executeSync(statement);
    db.executeSync("PRAGMA user_version = 14");
    db.executeSync("COMMIT");
    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(14);
    db.close();
  });

  it("refuses hydrate when blob user_version is newer than CURRENT (downgrade)", () => {
    const meta: SqliteSnapshotMeta = {
      userVersion: 15,
      bundleId: "hypercolor-web-schema-v14",
      generation: 1,
    };
    expect(() =>
      assertHydrateIntegrity(meta, 15, {
        currentVersion: 14,
        sqliteBundleId: "hypercolor-web-schema-v14",
      }),
    ).toThrow(SqliteSnapshotIntegrityError);
  });

  it("refuses hydrate when meta.userVersion disagrees with blob PRAGMA (corruption)", () => {
    const meta: SqliteSnapshotMeta = {
      userVersion: 12,
      bundleId: "hypercolor-web-schema-v13",
      generation: 1,
    };
    expect(() => assertHydrateIntegrity(meta, 13)).toThrow(SqliteSnapshotIntegrityError);
  });

  it("self-attack: matching user_version still hydrates; SQLite/SQL catch byte corruption", async () => {
    // A genuinely corrupt blob that still deserializes with coincidentally matching
    // user_version is NOT refused by this gate. sqlite3_deserialize rc, later SQL
    // errors, and FK checks catch some damage. The gate's job is meta/blob version
    // disagreement and downgrade — not a checksum. BundleId-only mismatch must not
    // wipe users.
    const db = applyThrough(12);
    expect(() =>
      assertHydrateIntegrity(
        { userVersion: 12, bundleId: "hypercolor-web-schema-v13", generation: 1 },
        12,
        { currentVersion: CURRENT_VERSION, sqliteBundleId: "hypercolor-web-schema-v14" },
      ),
    ).not.toThrow();
    await runMigrations(db);
    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(CURRENT_VERSION);
    db.close();
  });
});
