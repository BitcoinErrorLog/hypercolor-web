import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { SQLITE_BUNDLE_ID } from "./bundleId";
import { CURRENT_VERSION } from "./migrations";
import {
  ReadOnlyTabError,
  SqliteDeleteBlockedError,
  SqlitePersistError,
  SqliteSnapshotIntegrityError,
  SQLITE_BUNDLE_CHANGED_EVENT,
  SQLITE_PERSIST_FAILED_EVENT,
} from "./errors";
import { isMutatingSql } from "./mutatingSql";
import { wrapOo1Db, type ClosableSqlExecutor } from "./oo1Executor";
import {
  getTabLock,
  getTabLockOwnerScope,
  isYieldingTab,
  TAB_LOCK_UNSIGNED_SCOPE,
} from "@/services/tabLock";

export type { ClosableSqlExecutor } from "./oo1Executor";
export { isMutatingSql } from "./mutatingSql";

export type WebSqliteVfs = "idb-snapshot" | "kvvfs";

export const IDB_NAME = "hypercolor-sqlite";
export const IDB_STORE = "sqlite";
export const IDB_KEY = "hypercolor.db";
export const IDB_META_KEY = "hypercolor.db.meta";

export function currentSqliteIdbName(): string {
  const owner = getTabLockOwnerScope();
  if (!owner || owner === TAB_LOCK_UNSIGNED_SCOPE) return IDB_NAME;
  return `${IDB_NAME}:${owner}`;
}

let openedVfs: WebSqliteVfs | null = null;

export function getOpenedVfs(): WebSqliteVfs | null {
  return openedVfs;
}

export type SqliteSnapshotMeta = {
  userVersion: number;
  bundleId: string;
  generation: number;
  nonce?: string;
  ownerPubky?: string;
};

export const LEGACY_MIGRATE_READER_ATTEMPTS = 50;
export const LEGACY_MIGRATE_READER_DELAY_MS = 40;

const migrateChains = new Map<string, Promise<void>>();

let persistGeneration = 1;
let persistNonce = randomPersistNonce();

function randomPersistNonce(): string {
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export function currentPersistGeneration(): number {
  return persistGeneration;
}

export function currentPersistNonce(): string {
  return persistNonce;
}

/** Monotonic counter (not Date.now) plus a random nonce for same-generation ties. */
export function bumpPersistGeneration(): number {
  persistGeneration += 1;
  persistNonce = randomPersistNonce();
  return persistGeneration;
}

export function adoptPersistGenerationFromMeta(meta: SqliteSnapshotMeta | null): void {
  if (!meta || typeof meta.generation !== "number" || Number.isNaN(meta.generation)) return;
  if (meta.generation > persistGeneration) persistGeneration = meta.generation;
}

export function resetPersistGenerationForTests(): void {
  persistGeneration = 1;
  persistNonce = randomPersistNonce();
}

export function compareSnapshotMeta(
  left: Pick<SqliteSnapshotMeta, "generation" | "nonce">,
  right: Pick<SqliteSnapshotMeta, "generation" | "nonce">,
): number {
  if (left.generation !== right.generation) return left.generation - right.generation;
  const ln = left.nonce ?? "";
  const rn = right.nonce ?? "";
  if (ln === rn) return 0;
  return ln < rn ? -1 : 1;
}

type SqliteInit = (config?: {
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
  locateFile?: (file: string, prefix?: string) => string;
}) => Promise<Sqlite3Static>;

async function loadOfficialSqlite3(): Promise<Sqlite3Static> {
  const sqlite3InitModule = (await import("@sqlite.org/sqlite-wasm"))
    .default as SqliteInit;
  return sqlite3InitModule({
    print: () => undefined,
    printErr: (msg) => {
      console.error(msg);
    },
    locateFile: (file) => {
      if (file.endsWith(".wasm")) return "/sqlite3.wasm";
      return `/${file}`;
    },
  });
}

export type PersistableSqlExecutor = ClosableSqlExecutor & {
  flushPersist?: () => Promise<void>;
  persistForYield?: () => Promise<void>;
  discardClose?: () => void;
  rollbackOpenTransaction?: () => void;
};

function emitPersistFailed(err: SqlitePersistError): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SQLITE_PERSIST_FAILED_EVENT, { detail: err.message }));
}

function wrapIdbSnapshot(
  sqlite3: Sqlite3Static,
  db: Database,
): PersistableSqlExecutor {
  let txDepth = 0;
  let persistChain = Promise.resolve();
  let rolledBack = false;
  let lastPersistError: SqlitePersistError | null = null;
  const generation = persistGeneration;
  const nonce = persistNonce;
  let persistBlocked = false;

  const persistNow = (reason: "commit" | "autocommit" | "close") => {
    if (persistBlocked) return persistChain;
    const writer = getTabLock().mode === "writer";
    if (!writer) return persistChain;
    if (reason !== "close" && isYieldingTab()) return persistChain;
    if (rolledBack) return persistChain;
    if (!db.pointer) return persistChain;
    const bytes = sqlite3.capi.sqlite3_js_db_export(db.pointer);
    const versionRows = db.exec({
      sql: "PRAGMA user_version",
      rowMode: "object",
      returnValue: "resultRows",
    }) as Array<{ user_version?: number }>;
    const userVersion = Number(versionRows?.[0]?.user_version ?? 0);
    persistChain = persistChain
      .then(() =>
        putIdbSnapshot(bytes, snapshotMetaForPersist(userVersion, generation, nonce)),
      )
      .then(() => {
        lastPersistError = null;
      })
      .catch((err: unknown) => {
        lastPersistError = new SqlitePersistError(err);
        emitPersistFailed(lastPersistError);
      });
    void reason;
    return persistChain;
  };

  const inner = wrapOo1Db(db);

  return {
    executeSync(query, params) {
      if (lastPersistError) throw lastPersistError;
      const sql = query.trim();
      if (/^BEGIN\b/i.test(sql)) {
        rolledBack = false;
        const result = inner.executeSync(query, params);
        txDepth += 1;
        return result;
      }
      if (/^COMMIT\b/i.test(sql)) {
        const result = inner.executeSync(query, params);
        txDepth = Math.max(0, txDepth - 1);
        if (txDepth === 0) void persistNow("commit");
        return result;
      }
      if (/^ROLLBACK\b/i.test(sql)) {
        const result = inner.executeSync(query, params);
        txDepth = 0;
        rolledBack = true;
        return result;
      }
      const result = inner.executeSync(query, params);
      if (txDepth === 0 && isMutatingSql(sql)) void persistNow("autocommit");
      return result;
    },
    close() {
      if (getTabLock().mode === "writer" && !rolledBack && !persistBlocked) {
        void persistNow("close");
      }
      inner.close();
    },
    rollbackOpenTransaction() {
      if (txDepth <= 0) return;
      inner.executeSync("ROLLBACK");
      txDepth = 0;
      rolledBack = true;
    },
    discardClose() {
      persistBlocked = true;
      inner.close();
    },
    flushPersist() {
      return persistChain.then(() => {
        if (lastPersistError) throw lastPersistError;
      });
    },
    persistForYield() {
      return persistNow("close").then(() => {
        if (lastPersistError) throw lastPersistError;
      });
    },
  };
}

function openIdb(name = currentSqliteIdbName()): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("indexedDB.open failed"));
  });
}

function snapshotMetaForPersist(
  userVersion: number,
  generation: number,
  nonce: string,
): SqliteSnapshotMeta {
  const owner = getTabLockOwnerScope();
  return {
    userVersion,
    bundleId: SQLITE_BUNDLE_ID,
    generation,
    nonce,
    ...(owner && owner !== TAB_LOCK_UNSIGNED_SCOPE ? { ownerPubky: owner } : {}),
  };
}

function decodeSnapshotBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function parseSnapshotMeta(raw: unknown): SqliteSnapshotMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as SqliteSnapshotMeta;
  if (typeof rec.bundleId !== "string" || typeof rec.userVersion !== "number") return null;
  return {
    userVersion: Number(rec.userVersion),
    bundleId: String(rec.bundleId),
    generation: Number(rec.generation ?? 0),
    nonce: typeof rec.nonce === "string" ? rec.nonce : undefined,
    ownerPubky: typeof rec.ownerPubky === "string" && rec.ownerPubky.length > 0 ? rec.ownerPubky : undefined,
  };
}

function snapshotBytesPresent(bytes: Uint8Array | null): boolean {
  return !!bytes && bytes.byteLength > 0;
}

async function listIdbDatabaseNames(): Promise<string[] | null> {
  if (typeof indexedDB.databases !== "function") return null;
  try {
    const dbs = await indexedDB.databases();
    return dbs
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0);
  } catch {
    return null;
  }
}

async function idbDatabaseExists(name: string): Promise<boolean> {
  const names = await listIdbDatabaseNames();
  if (names) return names.includes(name);
  return false;
}

async function readNamedSnapshot(name: string): Promise<{
  bytes: Uint8Array | null;
  meta: SqliteSnapshotMeta | null;
}> {
  if (!(await idbDatabaseExists(name))) {
    const names = await listIdbDatabaseNames();
    if (names) return { bytes: null, meta: null };
  }
  const db = await openIdb(name);
  try {
    if (!db.objectStoreNames.contains(IDB_STORE)) {
      return { bytes: null, meta: null };
    }
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const blobReq = store.get(IDB_KEY);
      const metaReq = store.get(IDB_META_KEY);
      tx.oncomplete = () => {
        resolve({
          bytes: decodeSnapshotBytes(blobReq.result),
          meta: parseSnapshotMeta(metaReq.result),
        });
      };
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB get failed"));
    });
  } finally {
    db.close();
  }
}

async function namedIdbHasSnapshot(name: string): Promise<boolean> {
  const { bytes } = await readNamedSnapshot(name);
  return snapshotBytesPresent(bytes);
}

async function writeNamespacedIfEmpty(
  name: string,
  bytes: Uint8Array,
  meta: SqliteSnapshotMeta,
): Promise<boolean> {
  const db = await openIdb(name);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const blobReq = store.get(IDB_KEY);
      const metaReq = store.get(IDB_META_KEY);
      let alreadyPresent = false;
      let pending = 2;
      const onGet = () => {
        pending -= 1;
        if (pending !== 0) return;
        alreadyPresent = snapshotBytesPresent(decodeSnapshotBytes(blobReq.result));
        if (alreadyPresent) return;
        store.put(bytes, IDB_KEY);
        store.put(meta, IDB_META_KEY);
      };
      blobReq.onsuccess = onGet;
      metaReq.onsuccess = onGet;
      tx.oncomplete = () => resolve(alreadyPresent);
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB migrate put failed"));
    });
  } finally {
    db.close();
  }
}

async function mayAdoptLegacySnapshot(
  owner: string,
  meta: SqliteSnapshotMeta | null,
): Promise<boolean> {
  const metaOwner = meta?.ownerPubky;
  if (typeof metaOwner === "string" && metaOwner.length > 0) {
    if (metaOwner === owner) return true;
    console.info("[hypercolor-sqlite] leaving legacy snapshot owned by another identity", {
      metaOwner,
      owner,
    });
    return false;
  }
  console.info("[hypercolor-sqlite] leaving unidentified legacy snapshot; adoption requires an in-blob owner marker", {
    owner,
  });
  return false;
}

async function withExclusiveMigrateLock(owner: string, fn: () => Promise<void>): Promise<void> {
  const run = async () => {
    const prev = migrateChains.get(owner) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    migrateChains.set(owner, next.then(
      () => undefined,
      () => undefined,
    ));
    await next;
  };
  if (
    typeof navigator !== "undefined" &&
    navigator.locks &&
    typeof navigator.locks.request === "function"
  ) {
    await navigator.locks.request(`hypercolor-sqlite-migrate:${owner}`, { mode: "exclusive" }, async () => {
      await run();
    });
    return;
  }
  await run();
}

async function waitForNamespacedSnapshot(namespaced: string): Promise<void> {
  for (let attempt = 0; attempt < LEGACY_MIGRATE_READER_ATTEMPTS; attempt += 1) {
    if (await namedIdbHasSnapshot(namespaced)) return;
    if (!(await namedIdbHasSnapshot(IDB_NAME))) return;
    await delay(LEGACY_MIGRATE_READER_DELAY_MS);
  }
}

function snapshotBytesEqual(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  for (let i = 0; i < left.byteLength; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

async function maybeDeleteLeftoverLegacy(owner: string): Promise<void> {
  if (getTabLock().mode !== "writer" || isYieldingTab()) return;
  if (!(await namedIdbHasSnapshot(IDB_NAME))) return;
  const namespaced = `${IDB_NAME}:${owner}`;
  const [legacy, current] = await Promise.all([
    readNamedSnapshot(IDB_NAME),
    readNamedSnapshot(namespaced),
  ]);
  if (!snapshotBytesPresent(legacy.bytes) || !snapshotBytesPresent(current.bytes)) return;
  if (!snapshotBytesEqual(legacy.bytes, current.bytes)) return;
  const identified = typeof legacy.meta?.ownerPubky === "string" && legacy.meta.ownerPubky.length > 0;
  if (!identified) {
    console.info("[hypercolor-sqlite] retaining unidentified legacy snapshot after copy");
    return;
  }
  if (!(await mayAdoptLegacySnapshot(owner, legacy.meta))) return;
  try {
    await deleteIdbDatabaseOnce(IDB_NAME);
  } catch (err) {
    if (err instanceof SqliteDeleteBlockedError) {
      console.info("[hypercolor-sqlite] legacy IDB delete blocked; will retry on next open");
      return;
    }
    throw err;
  }
}

/**
 * One-time copy of the pre-namespace IndexedDB (`hypercolor-sqlite`) into
 * `hypercolor-sqlite:<owner>`. Writer-only. Unsigned tabs never run this.
 */
export async function migrateLegacySqliteSnapshotIfNeeded(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const owner = getTabLockOwnerScope();
  if (!owner || owner === TAB_LOCK_UNSIGNED_SCOPE) return;
  const namespaced = `${IDB_NAME}:${owner}`;
  if (await namedIdbHasSnapshot(namespaced)) {
    await maybeDeleteLeftoverLegacy(owner);
    return;
  }

  const writer = getTabLock().mode === "writer" && !isYieldingTab();
  if (!writer) {
    await waitForNamespacedSnapshot(namespaced);
    return;
  }

  await withExclusiveMigrateLock(owner, async () => {
    if (await namedIdbHasSnapshot(namespaced)) {
      await maybeDeleteLeftoverLegacy(owner);
      return;
    }
    const legacy = await readNamedSnapshot(IDB_NAME);
    if (!snapshotBytesPresent(legacy.bytes) || !legacy.bytes) return;
    if (!(await mayAdoptLegacySnapshot(owner, legacy.meta))) return;
    if (!legacy.meta) return;

    bumpPersistGeneration();
    const meta: SqliteSnapshotMeta = {
      userVersion: legacy.meta.userVersion,
      bundleId: legacy.meta.bundleId,
      generation: persistGeneration,
      nonce: persistNonce,
      ownerPubky: owner,
    };
    const alreadyPresent = await writeNamespacedIfEmpty(namespaced, legacy.bytes, meta);
    if (alreadyPresent) {
      await maybeDeleteLeftoverLegacy(owner);
      return;
    }

    const verify = await readNamedSnapshot(namespaced);
    if (
      !snapshotBytesPresent(verify.bytes) ||
      !verify.meta ||
      verify.bytes?.byteLength !== legacy.bytes.byteLength ||
      verify.meta.generation !== meta.generation ||
      verify.meta.bundleId !== meta.bundleId ||
      verify.meta.userVersion !== meta.userVersion
    ) {
      console.error("[hypercolor-sqlite] legacy migrate verify failed; leaving legacy in place");
      return;
    }

    await maybeDeleteLeftoverLegacy(owner);
  });
}

export async function getIdbSnapshot(): Promise<Uint8Array | null> {
  const { bytes } = await getIdbSnapshotAndMeta();
  return bytes;
}

async function getIdbSnapshotAndMeta(): Promise<{
  bytes: Uint8Array | null;
  meta: SqliteSnapshotMeta | null;
}> {
  return readNamedSnapshot(currentSqliteIdbName());
}

function isStalePut(meta: SqliteSnapshotMeta, existing: SqliteSnapshotMeta | undefined): boolean {
  if (meta.generation < persistGeneration) return true;
  if (!existing || typeof existing.generation !== "number") return false;
  return compareSnapshotMeta(existing, meta) > 0;
}

/**
 * Blob + meta are written in one IndexedDB transaction. A crash mid-put
 * cannot leave a blob without matching meta (or the reverse).
 */
export async function putIdbSnapshot(
  bytes: Uint8Array,
  meta: SqliteSnapshotMeta,
): Promise<void> {
  const db = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const existingReq = store.get(IDB_META_KEY);
      existingReq.onsuccess = () => {
        const existing = existingReq.result as SqliteSnapshotMeta | undefined;
        if (isStalePut(meta, existing)) {
          return;
        }
        store.put(bytes, IDB_KEY);
        store.put(meta, IDB_META_KEY);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("indexedDB put failed"));
    });
  } finally {
    db.close();
  }
}

/** Bump generation and persist meta before hydrate so late old-writer puts lose. */
export async function sealPersistGenerationInIdb(): Promise<void> {
  const { bytes, meta } = await getIdbSnapshotAndMeta();
  adoptPersistGenerationFromMeta(meta);
  bumpPersistGeneration();
  await putIdbSnapshot(
    bytes ?? new Uint8Array(0),
    snapshotMetaForPersist(meta?.userVersion ?? 0, persistGeneration, persistNonce),
  );
}

function hydrateMemoryDb(
  sqlite3: Sqlite3Static,
  bytes: Uint8Array | null,
): Database {
  const db = new sqlite3.oo1.DB(":memory:", "c");
  if (!bytes || bytes.byteLength === 0) return db;
  const pointer = db.pointer;
  if (pointer === undefined) {
    db.close();
    throw new Error("sqlite3 memory db has no pointer");
  }
  const wasmPtr = sqlite3.wasm.allocFromTypedArray(bytes);
  const rc = sqlite3.capi.sqlite3_deserialize(
    pointer,
    "main",
    wasmPtr,
    bytes.byteLength,
    bytes.byteLength,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
      sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
  );
  db.checkRc(rc);
  return db;
}

function pragmaUserVersion(db: Database): number {
  const versionRows = db.exec({
    sql: "PRAGMA user_version",
    rowMode: "object",
    returnValue: "resultRows",
  }) as Array<{ user_version?: number }>;
  return Number(versionRows?.[0]?.user_version ?? 0);
}

/**
 * Hydrate integrity: refuse only on meta/blob user_version disagreement
 * (corruption) or blob newer than this build (downgrade). bundleId mismatch
 * is informational — runMigrations upgrades a supported user_version.
 */
export function assertHydrateIntegrity(
  meta: SqliteSnapshotMeta,
  blobVersion: number,
  options?: { currentVersion?: number; sqliteBundleId?: string },
): void {
  const currentVersion = options?.currentVersion ?? CURRENT_VERSION;
  const sqliteBundleId = options?.sqliteBundleId ?? SQLITE_BUNDLE_ID;
  if (meta.bundleId !== sqliteBundleId) {
    console.info("[hypercolor-sqlite] snapshot bundleId changed", {
      from: meta.bundleId,
      to: sqliteBundleId,
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(SQLITE_BUNDLE_CHANGED_EVENT, {
          detail: { from: meta.bundleId, to: sqliteBundleId },
        }),
      );
    }
  }
  if (meta.userVersion !== blobVersion || blobVersion > currentVersion) {
    throw new SqliteSnapshotIntegrityError();
  }
}

async function openIdbSnapshotVfs(
  sqlite3: Sqlite3Static,
): Promise<PersistableSqlExecutor> {
  await migrateLegacySqliteSnapshotIfNeeded();
  const { bytes, meta } = await getIdbSnapshotAndMeta();
  adoptPersistGenerationFromMeta(meta);
  const db = hydrateMemoryDb(sqlite3, bytes);
  if (bytes && bytes.byteLength > 0 && meta) {
    const blobVersion = pragmaUserVersion(db);
    try {
      assertHydrateIntegrity(meta, blobVersion);
    } catch (err) {
      db.close();
      if (err instanceof SqliteSnapshotIntegrityError && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(SQLITE_PERSIST_FAILED_EVENT, { detail: err.message }),
        );
      }
      throw err;
    }
  }
  return wrapIdbSnapshot(sqlite3, db);
}

function openKvvfs(sqlite3: Sqlite3Static): PersistableSqlExecutor {
  const owner = getTabLockOwnerScope();
  if (owner !== TAB_LOCK_UNSIGNED_SCOPE) {
    throw new ReadOnlyTabError(
      "kvvfs fallback is unsigned-only so identities cannot share localStorage sqlite.",
    );
  }
  const db = new sqlite3.oo1.JsStorageDb("local");
  const inner = wrapOo1Db(db);
  return {
    executeSync(query, params) {
      if (getTabLock().mode !== "writer" || isYieldingTab()) {
        if (isMutatingSql(query) || /^\s*BEGIN\b/i.test(query)) {
          throw new ReadOnlyTabError(
            "kvvfs fallback refuses writes unless this tab is the writer.",
          );
        }
      }
      return inner.executeSync(query, params);
    },
    close: inner.close,
    flushPersist: async () => undefined,
    persistForYield: async () => undefined,
    discardClose() {
      inner.close();
    },
    rollbackOpenTransaction() {
      try {
        inner.executeSync("ROLLBACK");
      } catch {
        /* no open transaction */
      }
    },
  };
}

/**
 * Opens official sqlite3 wasm with the P1 VFS policy:
 * 1. Official sqlite3 memory + IndexedDB snapshot when IDB exists.
 * 2. Official kvvfs (`localStorage`) last. Tiny (~5MB); only if IDB is gone.
 *
 * `opfs-sahpool` is deliberately not used: its exclusive SyncAccessHandles
 * survive the document that opened them, so the next document's `getDb()`
 * blocks forever behind handles the previous page still holds.
 */
export async function openWebSqlite(): Promise<PersistableSqlExecutor> {
  if (typeof window === "undefined") {
    throw new Error(
      "Web SQLite requires a browser, or inject an executor with setDbExecutor() / setDbForTests().",
    );
  }

  const sqlite3 = await loadOfficialSqlite3();

  if (typeof indexedDB !== "undefined") {
    const executor = await openIdbSnapshotVfs(sqlite3);
    openedVfs = "idb-snapshot";
    return executor;
  }

  if (typeof sqlite3.oo1.JsStorageDb === "function") {
    const executor = openKvvfs(sqlite3);
    openedVfs = "kvvfs";
    return executor;
  }

  throw new Error("No SQLite VFS available in this browser");
}

export function clearOpenedVfs(): void {
  openedVfs = null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function deleteIdbDatabaseOnce(name = currentSqliteIdbName()): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    const timer = setTimeout(() => {
      reject(new SqliteDeleteBlockedError());
    }, 250);
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve();
    };
    req.onblocked = () => {
      clearTimeout(timer);
      reject(new SqliteDeleteBlockedError());
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error ?? new Error("indexedDB.deleteDatabase failed"));
    };
  });
}

/** Deletes the IDB sqlite snapshot and kvvfs localStorage keys. Keeps KeyStore. */
export async function deleteSqliteSnapshot(): Promise<void> {
  if (typeof indexedDB !== "undefined") {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await deleteIdbDatabaseOnce();
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
        if (!(err instanceof SqliteDeleteBlockedError)) throw err;
        await delay(40 * (attempt + 1));
      }
    }
    if (lastError) throw lastError;
  }
  if (typeof localStorage !== "undefined") {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.toLowerCase().startsWith("kvvfs")) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  }
}
