import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, refreshReadonlySnapshot, setDbExecutor } from "../index";
import { openMemoryDb } from "./betterSqliteAdapter";
import { resetTabLockForTests } from "@/services/tabLock";
import { IDB_KEY, IDB_NAME, IDB_STORE } from "../openWebSqlite";

vi.mock("../openWebSqlite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../openWebSqlite")>();
  return {
    ...actual,
    openWebSqlite: vi.fn(actual.openWebSqlite),
  };
});

import { openWebSqlite } from "../openWebSqlite";

const T0 = new TextEncoder().encode("T0-SNAPSHOT");
const T1 = new TextEncoder().encode("T1-NEWER-ROWS");

async function putIdbBytes(bytes: Uint8Array): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

async function readIdbBytes(): Promise<Uint8Array | null> {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(IDB_STORE, "readonly");
      const get = tx.objectStore(IDB_STORE).get(IDB_KEY);
      get.onsuccess = () => {
        const value = get.result;
        db.close();
        if (value instanceof Uint8Array) resolve(value);
        else if (value instanceof ArrayBuffer) resolve(new Uint8Array(value));
        else resolve(null);
      };
      get.onerror = () => reject(get.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe("F1 takeover discard-close", () => {
  afterEach(() => {
    closeDb();
    setDbExecutor(null);
    resetTabLockForTests();
    vi.unstubAllGlobals();
    vi.mocked(openWebSqlite).mockReset();
  });

  it("close() as writer would persist the stale T0 snapshot over T1 (the pre-fix bug)", async () => {
    await putIdbBytes(T1);
    const mem = openMemoryDb();
    const stale = {
      ...mem,
      close() {
        void putIdbBytes(T0).then(() => mem.close());
      },
      discardClose() {
        mem.close();
      },
      flushPersist: async () => undefined,
      persistForYield: async () => undefined,
    };
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _name: string,
          options: LockOptions,
          cb: (lock: unknown) => Promise<unknown>,
        ) => cb({ name: "hypercolor-writer" }),
      },
    });
    vi.mocked(openWebSqlite).mockResolvedValue(stale);
    const exec = (await getDb()) as unknown as { close: () => void };
    exec.close();
    await vi.waitFor(async () => {
      const bytes = await readIdbBytes();
      expect(bytes ? new TextDecoder().decode(bytes) : null).toBe("T0-SNAPSHOT");
    });
  });

  it("refreshReadonlySnapshot discard-close keeps T1 IDB bytes after takeover", async () => {
    await putIdbBytes(T1);
    const makeExec = () => {
      const mem = openMemoryDb();
      return {
        ...mem,
        close() {
          void putIdbBytes(T0).then(() => mem.close());
        },
        discardClose() {
          mem.close();
        },
        flushPersist: async () => undefined,
        persistForYield: async () => undefined,
      };
    };
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
    vi.mocked(openWebSqlite).mockImplementation(async () => makeExec());
    await getDb();
    await refreshReadonlySnapshot();
    const bytes = await readIdbBytes();
    expect(bytes ? new TextDecoder().decode(bytes) : null).toBe("T1-NEWER-ROWS");
  });
});
