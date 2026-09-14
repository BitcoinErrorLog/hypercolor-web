import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDbForTests } from "@/db";
import { openMemoryDb } from "@/db/__tests__/betterSqliteAdapter";
import { runMigrations } from "@/db/migrations";
import { KeyStore } from "@/services/KeyStore";
import { StorageService } from "@/services/StorageService";
import { LINK_RECEIVER_PATH } from "@/types/link";

const generateNoiseSecretKey = vi.fn();
const noisePublicKeyFromSecret = vi.fn();
const publishReceiverMarker = vi.fn();
const getReceiverMarker = vi.fn();
const putPublic = vi.fn();
const publicGet = vi.fn();
const getLiveSession = vi.fn();
const persistReceiverPath = vi.fn();

vi.mock("./PaykitLinkWeb", () => ({
  PaykitLinkWeb: {
    generateNoiseSecretKey: (...args: unknown[]) => generateNoiseSecretKey(...args),
    noisePublicKeyFromSecret: (...args: unknown[]) => noisePublicKeyFromSecret(...args),
    publishReceiverMarker: (...args: unknown[]) => publishReceiverMarker(...args),
    getReceiverMarker: (...args: unknown[]) => getReceiverMarker(...args),
    putPublic: (...args: unknown[]) => putPublic(...args),
    publicGet: (...args: unknown[]) => publicGet(...args),
  },
}));

vi.mock("./session", () => ({
  getLiveSession: () => getLiveSession(),
  persistReceiverPath: (...args: unknown[]) => persistReceiverPath(...args),
}));

import {
  drainReceiverPublishRetry,
  provisionReceiver,
  RECEIVER_MARKER_PUBLISH_BUDGET_MS,
  syncOwnReceiverRole,
  takeoverReceiver,
} from "./provisionReceiver";
import { useReceiverRoleStore } from "./receiverRoleStore";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const VALID_CAPABILITY = new TextEncoder().encode(
  '{"version":1,"kind":"hypercolor.receiver.capabilities","receiver_path":"hypercolor/wallet","chat_kinds_v":1}',
);

beforeEach(async () => {
  await KeyStore.initKeyStore();
  await KeyStore.clear();
  const db = openMemoryDb();
  await runMigrations(db);
  setDbForTests(db);
  generateNoiseSecretKey.mockReset().mockResolvedValue(new Uint8Array(32).fill(7));
  noisePublicKeyFromSecret.mockReset().mockResolvedValue("local-pk");
  publishReceiverMarker.mockReset().mockResolvedValue(undefined);
  getReceiverMarker.mockReset().mockResolvedValue(null);
  publicGet.mockReset().mockResolvedValue(VALID_CAPABILITY);
  putPublic.mockReset().mockResolvedValue(undefined);
  getLiveSession.mockReset().mockReturnValue(null);
  persistReceiverPath.mockReset().mockResolvedValue(undefined);
  useReceiverRoleStore.getState().reset();
});

afterEach(() => setDbForTests(null));

describe("provisionReceiver", () => {
  it("rejects a session owned by another identity before touching receiver state", async () => {
    await expect(
      provisionReceiver({ pubky: () => "another-owner" } as never, OWNER),
    ).rejects.toThrow("session owner mismatch");
    expect(generateNoiseSecretKey).not.toHaveBeenCalled();
  });

  it("publishes the typed marker, reconciles it, then writes only the key-bound capability", async () => {
    publicGet.mockResolvedValueOnce(undefined).mockResolvedValue(VALID_CAPABILITY);
    getReceiverMarker.mockResolvedValueOnce(null).mockResolvedValue({ noisePublicKey: "local-pk" });
    const session = { pubky: () => OWNER };
    const result = await provisionReceiver(session as never, OWNER);
    expect(result.receiverRole).toBe("active");
    expect(publishReceiverMarker).toHaveBeenCalledWith(
      session,
      LINK_RECEIVER_PATH,
      "local-pk",
      true,
      false,
      false,
      false,
    );
    expect(putPublic).toHaveBeenCalledWith(
      session,
      "/pub/hypercolor.app/v1/receivers/local-pk/capabilities.json",
      expect.any(Uint8Array),
    );
    expect(putPublic.mock.calls.some((call) => call[1] === "/pub/paykit.app/v0/receiver.json")).toBe(false);
    expect((await StorageService.getLinkReceiver(OWNER))?.markerPublished).toBe(true);
  });

  it("retains the same key and row after an ambiguous marker timeout", async () => {
    expect(RECEIVER_MARKER_PUBLISH_BUDGET_MS).toBe(15_000);
    getReceiverMarker.mockResolvedValue(null);
    publishReceiverMarker.mockRejectedValue(
      Object.assign(new Error("dispatch outcome unknown"), { name: "SessionResumeTimeout" }),
    );
    await expect(provisionReceiver({ pubky: () => OWNER } as never, OWNER)).rejects.toMatchObject({
      name: "SessionResumeTimeout",
    });
    expect(await KeyStore.getReceiverNoiseSecret(LINK_RECEIVER_PATH)).not.toBeNull();
    expect((await StorageService.getLinkReceiver(OWNER))?.markerPublished).toBe(false);
    expect(await StorageService.getLinkReceiverRetry(OWNER)).toMatchObject({
      noisePublicKey: "local-pk",
      attempts: 1,
    });
  });

  it("increases persistent publish failures with exponential backoff", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      getReceiverMarker.mockRejectedValue(new Error("network"));
      const session = { pubky: () => OWNER };

      await expect(provisionReceiver(session as never, OWNER)).rejects.toThrow("network");
      expect(await StorageService.getLinkReceiverRetry(OWNER)).toMatchObject({
        attempts: 1,
        nextRetryAt: Date.now() + 15_000,
      });

      await expect(provisionReceiver(session as never, OWNER)).rejects.toThrow("network");
      expect(await StorageService.getLinkReceiverRetry(OWNER)).toMatchObject({
        attempts: 2,
        nextRetryAt: Date.now() + 30_000,
      });

      await expect(provisionReceiver(session as never, OWNER)).rejects.toThrow("network");
      expect(await StorageService.getLinkReceiverRetry(OWNER)).toMatchObject({
        attempts: 3,
        nextRetryAt: Date.now() + 60_000,
      });
    } finally {
      now.mockRestore();
    }
  });

  it("deletes a capped retry without publishing", async () => {
    const session = { pubky: () => OWNER };
    await StorageService.upsertLinkReceiverRetry({
      ownerPubky: OWNER,
      sessionAlias: LINK_RECEIVER_PATH,
      noisePublicKey: "local-pk",
      attempts: 10,
      nextRetryAt: 0,
    });
    getLiveSession.mockReturnValue({ pubky: OWNER, handle: session });

    await expect(drainReceiverPublishRetry(1)).resolves.toBe(false);
    expect(await StorageService.getLinkReceiverRetry(OWNER)).toBeNull();
    expect(publishReceiverMarker).not.toHaveBeenCalled();
  });

  it("clears a retry after successful reconciliation", async () => {
    await StorageService.upsertLinkReceiverRetry({
      ownerPubky: OWNER,
      sessionAlias: LINK_RECEIVER_PATH,
      noisePublicKey: "local-pk",
      attempts: 1,
      nextRetryAt: 0,
    });
    getReceiverMarker.mockResolvedValue({ noisePublicKey: "local-pk" });

    await expect(provisionReceiver({ pubky: () => OWNER } as never, OWNER)).resolves.toMatchObject({
      receiverRole: "active",
    });
    expect(await StorageService.getLinkReceiverRetry(OWNER)).toBeNull();
  });

  it("does not overwrite a foreign production marker", async () => {
    getReceiverMarker.mockResolvedValue({ noisePublicKey: "foreign-pk" });
    const result = await provisionReceiver({ pubky: () => OWNER } as never, OWNER);
    expect(result.receiverRole).toBe("standby");
    expect(publishReceiverMarker).not.toHaveBeenCalled();
    expect(putPublic).not.toHaveBeenCalled();
  });

  it("reconciles takeover before publishing the capability", async () => {
    publicGet.mockResolvedValueOnce(undefined).mockResolvedValue(VALID_CAPABILITY);
    getReceiverMarker
      .mockResolvedValueOnce({ noisePublicKey: "foreign-pk" })
      .mockResolvedValue({ noisePublicKey: "local-pk" });
    await provisionReceiver({ pubky: () => OWNER } as never, OWNER);
    publishReceiverMarker.mockClear();
    await takeoverReceiver({ pubky: () => OWNER } as never, OWNER);
    expect(publishReceiverMarker).toHaveBeenCalledTimes(1);
    expect(putPublic).toHaveBeenCalledWith(
      expect.anything(),
      "/pub/hypercolor.app/v1/receivers/local-pk/capabilities.json",
      expect.any(Uint8Array),
    );
  });

  it("preserves an active role when discovery later sees the marker absent", async () => {
    getReceiverMarker.mockResolvedValueOnce(null).mockResolvedValue({ noisePublicKey: "local-pk" });
    await provisionReceiver({ pubky: () => OWNER } as never, OWNER);
    getReceiverMarker.mockResolvedValue(null);
    expect(await syncOwnReceiverRole(OWNER)).toBe("active");
    expect(useReceiverRoleStore.getState().needsReenable).toBe(true);
  });
});
