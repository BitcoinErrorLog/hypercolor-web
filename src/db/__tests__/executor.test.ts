import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../migrations";
import {
  applyConnectionPreamble,
  closeDb,
  getDb,
  setDbExecutor,
  setDbForTests,
} from "../index";
import { openFileDb, openMemoryDb } from "./betterSqliteAdapter";

vi.mock("../openWebSqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../openWebSqlite")>();
  return {
    ...actual,
    openWebSqlite: vi.fn(actual.openWebSqlite),
  };
});

import { openWebSqlite } from "../openWebSqlite";

describe("web SqlExecutor", () => {
  afterEach(() => {
    closeDb();
    setDbExecutor(null);
    vi.mocked(openWebSqlite).mockReset();
    vi.mocked(openWebSqlite).mockImplementation(async () => {
      throw new Error(
        "Web SQLite requires a browser, or inject an executor with setDbExecutor() / setDbForTests().",
      );
    });
  });

  it("setDbExecutor injects the handle returned by getDb()", async () => {
    const db = openMemoryDb();
    setDbExecutor(db);
    await expect(getDb()).resolves.toBe(db);
    expect(openWebSqlite).not.toHaveBeenCalled();
  });

  it("setDbForTests is an alias of setDbExecutor", async () => {
    const db = openMemoryDb();
    setDbForTests(db);
    await expect(getDb()).resolves.toBe(db);
    setDbForTests(null);
    await expect(getDb()).rejects.toThrow(/inject an executor/);
  });

  it("applies WAL and foreign_keys on the production getDb path", async () => {
    const file = path.join(
      os.tmpdir(),
      `hypercolor-wal-${process.pid}-${Date.now()}.db`,
    );
    const db = openFileDb(file);
    vi.mocked(openWebSqlite).mockResolvedValue(db);
    try {
      const exec = await getDb();
      expect(exec.executeSync("PRAGMA journal_mode").rows?.[0]?.journal_mode).toBe(
        "wal",
      );
      expect(exec.executeSync("PRAGMA foreign_keys").rows?.[0]?.foreign_keys).toBe(
        1,
      );
      expect(exec.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(
        14,
      );
    } finally {
      closeDb();
      try {
        db.close();
      } catch {
        // already closed by closeDb()
      }
      for (const extra of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(file + extra);
        } catch {
          // ignore missing sidecar
        }
      }
    }
  });

  it("applyConnectionPreamble sets WAL + foreign_keys on a file db", () => {
    const file = path.join(
      os.tmpdir(),
      `hypercolor-preamble-${process.pid}-${Date.now()}.db`,
    );
    const db = openFileDb(file);
    try {
      applyConnectionPreamble(db);
      expect(db.executeSync("PRAGMA journal_mode").rows?.[0]?.journal_mode).toBe(
        "wal",
      );
      expect(db.executeSync("PRAGMA foreign_keys").rows?.[0]?.foreign_keys).toBe(
        1,
      );
    } finally {
      db.close();
      for (const extra of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(file + extra);
        } catch {
          // ignore
        }
      }
    }
  });

  it("runMigrations is idempotent at user_version 14", async () => {
    const db = openMemoryDb();
    await runMigrations(db);
    await runMigrations(db);
    expect(db.executeSync("PRAGMA user_version").rows?.[0]?.user_version).toBe(
      14,
    );
    expect(
      db.executeSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mesh_peers'",
      ).rows,
    ).toHaveLength(1);
  });

  it("pagehide closes the live handle and getDb() reopens lazily", async () => {
    // src/db/index.ts registers window pagehide -> closeDb(). Under node vitest
    // that listener is not installed (no window at module load), so call closeDb
    // directly — the same function the browser listener invokes.
    const source = fs.readFileSync(path.join(__dirname, "..", "index.ts"), "utf8");
    expect(source).toMatch(/addEventListener\([\'"]pagehide[\'"]/);
    expect(source).toMatch(/closeDb\(\)/);

    const file = path.join(
      os.tmpdir(),
      `hypercolor-pagehide-${process.pid}-${Date.now()}.db`,
    );
    const first = openFileDb(file);
    const originalClose = first.close.bind(first);
    const close = vi.fn(() => {
      originalClose();
    });
    (first as { close: () => void }).close = close;
    vi.mocked(openWebSqlite).mockResolvedValueOnce(first);

    const second = openFileDb(file + "-reopen");
    vi.mocked(openWebSqlite).mockResolvedValueOnce(second);

    const exec = await getDb();
    expect(exec).not.toBe(first);
    exec.executeSync("SELECT 1 AS n");
    closeDb();
    expect(close).toHaveBeenCalledTimes(1);

    const again = await getDb();
    expect(again).not.toBe(exec);
    expect(openWebSqlite).toHaveBeenCalledTimes(2);

    closeDb();
    try {
      second.close();
    } catch {
      // already closed
    }
    for (const base of [file, file + "-reopen"]) {
      for (const extra of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(base + extra);
        } catch {
          // ignore
        }
      }
    }
  });

});
