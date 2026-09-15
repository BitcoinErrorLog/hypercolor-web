import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backupLatestUrl } from "./crypto";

const OWNER = "a".repeat(52);
const OTHER = "b".repeat(52);
const BLOB = JSON.stringify({
  version: 1,
  algorithm: "XChaCha20Poly1305",
  nonceB64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  ciphertextB64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
});

const putPublic = vi.fn();
const publicGet = vi.fn();
let live: { pubky: string; handle: { putPublic: typeof putPublic } } | null = null;

vi.mock("../link/PaykitLinkWeb", async () => {
  const actual = await vi.importActual<typeof import("../link/PaykitLinkWeb")>(
    "../link/PaykitLinkWeb",
  );
  return {
    ...actual,
    PaykitLinkWeb: {
      putPublic: (...args: unknown[]) => putPublic(...args),
      publicGet: (...args: unknown[]) => publicGet(...args),
    },
  };
});

vi.mock("../link/session", () => ({
  getLiveSession: () => live,
}));

import {
  createHomeserverBackupTransport,
  parseBackupHomeserverUrl,
} from "./homeserver";
import { BackupService, configureBackupTransport } from "./BackupService";
import { KeyStore } from "../KeyStore";

describe("backup homeserver transport", () => {
  const transport = createHomeserverBackupTransport();

  beforeEach(() => {
    putPublic.mockReset().mockResolvedValue(undefined);
    publicGet.mockReset().mockResolvedValue(undefined);
    live = { pubky: OWNER, handle: { putPublic } };
  });

  afterEach(() => {
    live = null;
    configureBackupTransport(null);
  });

  it("parses only the owner backup latest URL", () => {
    expect(parseBackupHomeserverUrl(backupLatestUrl(OWNER))).toEqual({
      ownerPubky: OWNER,
      path: "/pub/hypercolor.app/v1/backup/latest",
    });
    expect(() =>
      parseBackupHomeserverUrl(`pubky://${OWNER}/pub/hypercolor.app/v1/other`),
    ).toThrow("backup url is not the owner latest path");
  });

  it("PUTs the encrypted blob as UTF-8 on /pub/hypercolor.app/v1/backup/latest", async () => {
    await transport.putOwner(backupLatestUrl(OWNER), BLOB);
    expect(putPublic).toHaveBeenCalledTimes(1);
    expect(putPublic).toHaveBeenCalledWith(
      live!.handle,
      "/pub/hypercolor.app/v1/backup/latest",
      new TextEncoder().encode(BLOB),
    );
  });

  it("throws on PUT when no session is live", async () => {
    live = null;
    await expect(transport.putOwner(backupLatestUrl(OWNER), BLOB)).rejects.toThrow(
      "no owner session",
    );
    expect(putPublic).not.toHaveBeenCalled();
  });

  it("refuses PUT for a different owner URL", async () => {
    await expect(transport.putOwner(backupLatestUrl(OTHER), BLOB)).rejects.toThrow(
      "Backup belongs to a different account",
    );
    expect(putPublic).not.toHaveBeenCalled();
  });

  it("GET returns the blob string and maps 404 to null", async () => {
    publicGet.mockResolvedValueOnce(new TextEncoder().encode(BLOB));
    await expect(transport.getPublic(backupLatestUrl(OWNER))).resolves.toBe(BLOB);
    expect(publicGet).toHaveBeenCalledWith(
      OWNER,
      "/pub/hypercolor.app/v1/backup/latest",
    );

    publicGet.mockResolvedValueOnce(undefined);
    await expect(transport.getPublic(backupLatestUrl(OWNER))).resolves.toBeNull();
  });

  it("GET does not require a live session", async () => {
    live = null;
    publicGet.mockResolvedValueOnce(new TextEncoder().encode(BLOB));
    await expect(transport.getPublic(backupLatestUrl(OWNER))).resolves.toBe(BLOB);
  });

  it("GET maps a thrown 404 to null and rethrows other errors", async () => {
    publicGet.mockRejectedValueOnce(Object.assign(new Error("404 Not Found"), { name: "NotFound" }));
    await expect(transport.getPublic(backupLatestUrl(OWNER))).resolves.toBeNull();

    publicGet.mockRejectedValueOnce(
      Object.assign(new Error("failed to fetch"), { name: "NetworkError" }),
    );
    await expect(transport.getPublic(backupLatestUrl(OWNER))).rejects.toThrow(
      "BackupService: network error",
    );

    publicGet.mockRejectedValueOnce(new Error("invalid path"));
    await expect(transport.getPublic(backupLatestUrl(OWNER))).rejects.toThrow(
      "BackupService: validation failed",
    );

    publicGet.mockRejectedValueOnce(new Error("homeserver protocol broke"));
    await expect(transport.getPublic(backupLatestUrl(OWNER))).rejects.toThrow(
      "BackupService: protocol error",
    );
  });
});

describe("BackupService session fallback", () => {
  beforeEach(async () => {
    putPublic.mockReset().mockResolvedValue(undefined);
    publicGet.mockReset().mockResolvedValue(undefined);
    live = { pubky: OWNER, handle: { putPublic } };
    configureBackupTransport(null);
    await KeyStore.initKeyStore();
    await KeyStore.clear();
    await KeyStore.setPubky(OWNER);
  });

  afterEach(async () => {
    live = null;
    configureBackupTransport(null);
    await KeyStore.clear();
  });

  it("export PUTs through PaykitLinkWeb when a session is live and no hook is set", async () => {
    const { setDbForTests } = await import("../../db");
    const { openMemoryDb } = await import("../../db/__tests__/betterSqliteAdapter");
    const { runMigrations } = await import("../../db/migrations");
    const db = openMemoryDb();
    setDbForTests(db);
    await runMigrations(db);

    const result = await BackupService.exportBackup();
    expect(result.path).toBe(backupLatestUrl(OWNER));
    expect(putPublic).toHaveBeenCalledTimes(1);
    expect(putPublic.mock.calls[0]?.[1]).toBe("/pub/hypercolor.app/v1/backup/latest");
    const body = putPublic.mock.calls[0]?.[2] as Uint8Array;
    const stored = new TextDecoder().decode(body);
    expect(JSON.parse(stored).algorithm).toBe("XChaCha20Poly1305");

    setDbForTests(null);
  });
});
