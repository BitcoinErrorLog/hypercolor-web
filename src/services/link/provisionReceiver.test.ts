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
  waitForCapabilityRetryDrainForTests,
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

afterEach(async () => {
  await waitForCapabilityRetryDrainForTests();
  setDbForTests(null);
});

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
    getLiveSession.mockReturnValueOnce({ pubky: OWNER, handle: session }).mockReturnValue(null);
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
    await vi.waitFor(() => expect(putPublic).toHaveBeenCalledWith(
      session,
      "/pub/hypercolor.app/v1/receivers/local-pk/capabilities.json",
      expect.any(Uint8Array),
    ));
    await vi.waitFor(async () => expect(await StorageService.getLinkReceiverRetry(OWNER)).toBeNull());
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
      stage: "marker",
      attempts: 1,
    });
  });

  it("replays an unknown marker publish before capability publication", async () => {
    const session = { pubky: () => OWNER };
    getReceiverMarker.mockResolvedValue(null);
    publishReceiverMarker.mockRejectedValueOnce(new Error("network"));
    await expect(provisionReceiver(session as never, OWNER)).rejects.toThrow("network");
    publishReceiverMarker.mockResolvedValue(undefined);
    getReceiverMarker.mockResolvedValueOnce(null).mockResolvedValue({ noisePublicKey: "local-pk" });
    publicGet.mockResolvedValueOnce(undefined).mockResolvedValue(VALID_CAPABILITY);
    getLiveSession
      .mockReturnValueOnce({ pubky: OWNER, handle: session })
      .mockReturnValueOnce({ pubky: OWNER, handle: session })
      .mockReturnValue(null);

    await expect(drainReceiverPublishRetry(Date.now() + 15_000)).resolves.toBe(true);

    expect(publishReceiverMarker).toHaveBeenCalledTimes(2);
    expect(await StorageService.getLinkReceiverRetry(OWNER)).toMatchObject({ stage: "capability" });
    expect((await StorageService.getLinkReceiver(OWNER))?.markerPublished).toBe(true);
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
      stage: "marker",
      attempts: 10,
      nextRetryAt: 0,
    });
    getLiveSession.mockReturnValue({ pubky: OWNER, handle: session });

    await expect(drainReceiverPublishRetry(1)).resolves.toBe(false);
    expect(await StorageService.getLinkReceiverRetry(OWNER)).toBeNull();
    expect(publishReceiverMarker).not.toHaveBeenCalled();
  });

  it("resolves after marker confirmation when capability GET never settles and retains a retry row", async () => {
    const session = { pubky: () => OWNER };
    getReceiverMarker.mockResolvedValue({ noisePublicKey: "local-pk" });
    publicGet.mockReturnValue(new Promise<Uint8Array>(() => {}));

    await expect(provisionReceiver(session as never, OWNER)).resolves.toMatchObject({
      receiverRole: "active",
    });
    expect(await StorageService.getLinkReceiverRetry(OWNER)).toMatchObject({
      noisePublicKey: "local-pk",
      attempts: 0,
    });
  });

  it("records a transient retry after a capability GET times out", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const nativeSetTimeout = globalThis.setTimeout;
    const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 15_000) {
        queueMicrotask(() => {
          if (typeof handler === "function") (handler as (...callbackArgs: unknown[]) => void)(...args);
        });
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return nativeSetTimeout(handler, delay, ...args);
    }) as typeof setTimeout);
    try {
      const session = { pubky: () => OWNER };
      getLiveSession.mockReturnValue({ pubky: OWNER, handle: session });
      getReceiverMarker.mockResolvedValue({ noisePublicKey: "local-pk" });
      publicGet.mockReturnValue(new Promise<Uint8Array>(() => {}));

      await expect(provisionReceiver(session as never, OWNER)).resolves.toMatchObject({
        receiverRole: "active",
      });
      await vi.waitFor(async () =>
        expect(await StorageService.getLinkReceiverRetry(OWNER)).toMatchObject({
          attempts: 1,
          nextRetryAt: 1_700_000_015_000,
        }),
      );
    } finally {
      timer.mockRestore();
      now.mockRestore();
    }
  });

  it("clears a capability retry after an asynchronous successful drain", async () => {
    const session = { pubky: () => OWNER };
    getLiveSession.mockReturnValue({ pubky: OWNER, handle: session });
    getReceiverMarker.mockResolvedValue({ noisePublicKey: "local-pk" });

    await expect(provisionReceiver(session as never, OWNER)).resolves.toMatchObject({
      receiverRole: "active",
    });
    await vi.waitFor(async () => expect(await StorageService.getLinkReceiverRetry(OWNER)).toBeNull());
    expect((await StorageService.getLinkReceiver(OWNER))?.markerPublished).toBe(true);
  });

  it("routes a capability retry with an absent marker through marker republish", async () => {
    const session = { pubky: () => OWNER };
    await KeyStore.setPubky(OWNER);
    await KeyStore.setReceiverNoiseSecret(LINK_RECEIVER_PATH, new Uint8Array(32).fill(7));
    await StorageService.upsertLinkReceiver({
      ownerPubky: OWNER,
      receiverAlias: LINK_RECEIVER_PATH,
      receiverPath: LINK_RECEIVER_PATH,
      markerPublished: false,
      receiverRole: "active",
      lastSeenOwnMarkerPk: null,
    });
    await StorageService.upsertLinkReceiverRetry({
      ownerPubky: OWNER,
      sessionAlias: LINK_RECEIVER_PATH,
      noisePublicKey: "local-pk",
      stage: "capability",
      attempts: 0,
      nextRetryAt: 0,
    });
    getLiveSession
      .mockReturnValueOnce({ pubky: OWNER, handle: session })
      .mockReturnValueOnce({ pubky: OWNER, handle: session })
      .mockReturnValue(null);
    getReceiverMarker
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ noisePublicKey: "local-pk" });
    publicGet.mockResolvedValueOnce(undefined).mockResolvedValue(VALID_CAPABILITY);

    await expect(drainReceiverPublishRetry(1)).resolves.toBe(true);

    expect(publishReceiverMarker).toHaveBeenCalledWith(
      session,
      LINK_RECEIVER_PATH,
      "local-pk",
      true,
      false,
      false,
      false,
    );
  });

  it("keeps a rerouted marker retry after marker provisioning fails transiently", async () => {
    const session = { pubky: () => OWNER };
    await KeyStore.setPubky(OWNER);
    await KeyStore.setReceiverNoiseSecret(LINK_RECEIVER_PATH, new Uint8Array(32).fill(7));
    await StorageService.upsertLinkReceiver({
      ownerPubky: OWNER,
      receiverAlias: LINK_RECEIVER_PATH,
      receiverPath: LINK_RECEIVER_PATH,
      markerPublished: false,
      receiverRole: "active",
      lastSeenOwnMarkerPk: null,
    });
    await StorageService.upsertLinkReceiverRetry({
      ownerPubky: OWNER,
      sessionAlias: LINK_RECEIVER_PATH,
      noisePublicKey: "local-pk",
      stage: "capability",
      attempts: 0,
      nextRetryAt: 0,
    });
    getLiveSession.mockReturnValue({ pubky: OWNER, handle: session });
    getReceiverMarker.mockResolvedValue(null);
    publishReceiverMarker.mockRejectedValue(new Error("network"));

    await expect(drainReceiverPublishRetry(1)).resolves.toBe(false);

    expect(await StorageService.getLinkReceiverRetry(OWNER)).toMatchObject({
      stage: "marker",
      attempts: 3,
    });
  });

  it("does not retain a rerouted retry after sign-out during the reroute", async () => {
    const session = { pubky: () => OWNER };
    await StorageService.upsertLinkReceiver({
      ownerPubky: OWNER,
      receiverAlias: LINK_RECEIVER_PATH,
      receiverPath: LINK_RECEIVER_PATH,
      markerPublished: false,
      receiverRole: "active",
      lastSeenOwnMarkerPk: null,
    });
    await StorageService.upsertLinkReceiverRetry({
      ownerPubky: OWNER,
      sessionAlias: LINK_RECEIVER_PATH,
      noisePublicKey: "local-pk",
      stage: "capability",
      attempts: 0,
      nextRetryAt: 0,
    });
    getLiveSession.mockReturnValueOnce({ pubky: OWNER, handle: session }).mockReturnValue(null);
    getReceiverMarker.mockResolvedValue(null);
    const receiver = await StorageService.getLinkReceiver(OWNER);
    const getReceiver = vi.spyOn(StorageService, "getLinkReceiver").mockImplementationOnce(async () => {
      await StorageService.deleteLinkReceiverRetry(OWNER);
      return receiver;
    });

    try {
      await expect(drainReceiverPublishRetry(1)).resolves.toBe(false);

      expect(await StorageService.getLinkReceiverRetry(OWNER)).toBeNull();
      expect(publishReceiverMarker).not.toHaveBeenCalled();
    } finally {
      getReceiver.mockRestore();
    }
  });

  it("does not restore a retry row after sign-out wipes it during a transient drain failure", async () => {
    const session = { pubky: () => OWNER };
    await StorageService.upsertLinkReceiverRetry({
      ownerPubky: OWNER,
      sessionAlias: LINK_RECEIVER_PATH,
      noisePublicKey: "local-pk",
      stage: "capability",
      attempts: 0,
      nextRetryAt: 0,
    });
    getLiveSession.mockReturnValueOnce({ pubky: OWNER, handle: session }).mockReturnValue(null);
    getReceiverMarker.mockResolvedValue({ noisePublicKey: "local-pk" });
    publicGet.mockImplementation(async () => {
      await StorageService.deleteLinkReceiverRetry(OWNER);
      throw new Error("network");
    });

    await expect(drainReceiverPublishRetry(1)).resolves.toBe(false);

    expect(await StorageService.getLinkReceiverRetry(OWNER)).toBeNull();
  });

  it("contains retry retention errors after the database closes", async () => {
    const session = { pubky: () => OWNER };
    await StorageService.upsertLinkReceiverRetry({
      ownerPubky: OWNER,
      sessionAlias: LINK_RECEIVER_PATH,
      noisePublicKey: "local-pk",
      stage: "capability",
      attempts: 0,
      nextRetryAt: 0,
    });
    getLiveSession.mockReturnValue({ pubky: OWNER, handle: session });
    getReceiverMarker.mockResolvedValue({ noisePublicKey: "local-pk" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    publicGet.mockImplementation(async () => {
      setDbForTests(null);
      throw new Error("network");
    });

    try {
      await expect(drainReceiverPublishRetry(1)).resolves.toBe(false);
      expect(warn).toHaveBeenCalledWith(
        "[provisionReceiver] capability retry retain failed:",
        expect.any(Error),
      );
    } finally {
      warn.mockRestore();
    }
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
    const session = { pubky: () => OWNER };
    getLiveSession.mockReturnValue({ pubky: OWNER, handle: session });
    await provisionReceiver(session as never, OWNER);
    publishReceiverMarker.mockClear();
    await takeoverReceiver(session as never, OWNER);
    expect(publishReceiverMarker).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(putPublic).toHaveBeenCalledWith(
      expect.anything(),
      "/pub/hypercolor.app/v1/receivers/local-pk/capabilities.json",
      expect.any(Uint8Array),
    ));
    await vi.waitFor(async () => expect(await StorageService.getLinkReceiverRetry(OWNER)).toBeNull());
  });

  it("preserves an active role when discovery later sees the marker absent", async () => {
    getReceiverMarker.mockResolvedValueOnce(null).mockResolvedValue({ noisePublicKey: "local-pk" });
    await provisionReceiver({ pubky: () => OWNER } as never, OWNER);
    getReceiverMarker.mockResolvedValue(null);
    expect(await syncOwnReceiverRole(OWNER)).toBe("active");
    expect(useReceiverRoleStore.getState().needsReenable).toBe(true);
  });
});
