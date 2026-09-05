import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadOnlyTabError } from "../errors";
import { closeDb, getDb, setDbExecutor } from "../index";
import { openMemoryDb } from "./betterSqliteAdapter";
import { resetTabLockForTests } from "@/services/tabLock";

vi.mock("../openWebSqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../openWebSqlite")>();
  return {
    ...actual,
    openWebSqlite: vi.fn(actual.openWebSqlite),
  };
});

import { openWebSqlite } from "../openWebSqlite";

describe("readonly tab getDb", () => {
  afterEach(() => {
    closeDb();
    setDbExecutor(null);
    resetTabLockForTests();
    vi.unstubAllGlobals();
    vi.mocked(openWebSqlite).mockReset();
  });

  it("opens the snapshot for reads and throws ReadOnlyTabError on writes", async () => {
    resetTabLockForTests();
    const db = openMemoryDb();
    vi.mocked(openWebSqlite).mockResolvedValue({
      ...db,
      flushPersist: async () => undefined,
    });

    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _name: string,
          options: LockOptions,
          cb: (lock: unknown) => Promise<unknown>,
        ) => {
          if (options.ifAvailable) return cb(null);
          return cb({ name: "hypercolor-writer" });
        },
      },
    });

    const exec = await getDb();
    expect(exec.executeSync("SELECT 1 AS n").rows?.[0]).toEqual({ n: 1 });
    expect(() => exec.executeSync("DELETE FROM mesh_peers")).toThrow(ReadOnlyTabError);
    expect(() => exec.executeSync("BEGIN")).toThrow(ReadOnlyTabError);
  });
});
