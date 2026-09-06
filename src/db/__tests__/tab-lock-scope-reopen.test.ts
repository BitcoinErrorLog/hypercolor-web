import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, setDbExecutor } from "../index";
import { openMemoryDb } from "./betterSqliteAdapter";
import { resetTabLockForTests, setTabLockOwner } from "@/services/tabLock";

vi.mock("../openWebSqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../openWebSqlite")>();
  return {
    ...actual,
    openWebSqlite: vi.fn(actual.openWebSqlite),
  };
});

import { openWebSqlite } from "../openWebSqlite";

function makeExec() {
  const mem = openMemoryDb();
  let discarded = false;
  return {
    ...mem,
    discarded: () => discarded,
    close() {
      mem.close();
    },
    discardClose() {
      discarded = true;
      mem.close();
    },
    flushPersist: async () => undefined,
    persistForYield: async () => undefined,
  };
}

describe("tab lock owner scope reopens the sqlite handle", () => {
  afterEach(() => {
    closeDb();
    setDbExecutor(null);
    resetTabLockForTests();
    vi.unstubAllGlobals();
    vi.mocked(openWebSqlite).mockReset();
  });

  it("discardClose + getDb on owner-scope change so the handle targets the namespaced DB", async () => {
    const first = makeExec();
    const second = makeExec();
    vi.mocked(openWebSqlite).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _name: string,
          _options: LockOptions,
          cb: (lock: unknown) => Promise<unknown>,
        ) => cb({ name: "hypercolor-writer" }),
      },
    });

    const exec = await getDb();
    expect(exec.executeSync("SELECT 1 AS n").rows?.[0]).toEqual({ n: 1 });
    setTabLockOwner("alice-pubky");
    await vi.waitFor(() => expect(vi.mocked(openWebSqlite).mock.calls.length).toBe(2));
    expect(first.discarded()).toBe(true);
  });
});
