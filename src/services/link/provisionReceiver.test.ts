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

vi.mock("./PaykitLinkWeb", () => ({
  PaykitLinkWeb: {
    generateNoiseSecretKey: (...args: unknown[]) => generateNoiseSecretKey(...args),
    noisePublicKeyFromSecret: (...args: unknown[]) =>
      noisePublicKeyFromSecret(...args),
    publishReceiverMarker: (...args: unknown[]) => publishReceiverMarker(...args),
    getReceiverMarker: (...args: unknown[]) => getReceiverMarker(...args),
  },
}));

import { provisionReceiver, RECEIVER_MARKER_PUBLISH_BUDGET_MS, takeoverReceiver } from "./provisionReceiver";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

async function waitForPublishToStart(): Promise<void> {
  for (let i = 0; i < 200 && publishReceiverMarker.mock.calls.length === 0; i += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(publishReceiverMarker).toHaveBeenCalled();
}

describe("provisionReceiver", () => {
  beforeEach(async () => {
    await KeyStore.initKeyStore();
    await KeyStore.clear();
    const db = openMemoryDb();
    runMigrations(db);
    setDbForTests(db);
    generateNoiseSecretKey.mockReset();
    noisePublicKeyFromSecret.mockReset();
    publishReceiverMarker.mockReset();
    getReceiverMarker.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    setDbForTests(null);
  });

  it("wraps the Noise secret and publishes a messaging-only marker", async () => {
    const secret = new Uint8Array(32).fill(7);
    const persisted = new Uint8Array(secret);
    generateNoiseSecretKey.mockResolvedValue(secret);
    noisePublicKeyFromSecret.mockResolvedValue("noise-pk-z32");
    publishReceiverMarker.mockResolvedValue(undefined);
    const session = { pubky: () => OWNER };

    const result = await provisionReceiver(session as never, OWNER);

    expect(result).toEqual({
      pubky: OWNER,
      receiverPath: LINK_RECEIVER_PATH,
      noisePublicKey: "noise-pk-z32",
      receiverRole: "active",
    });
    expect(secret).toEqual(new Uint8Array(32));
    expect(await KeyStore.getReceiverNoiseSecret(LINK_RECEIVER_PATH)).toEqual(
      persisted,
    );
    expect(publishReceiverMarker).toHaveBeenCalledWith(
      session,
      LINK_RECEIVER_PATH,
      "noise-pk-z32",
      true,
      false,
      false,
      false,
    );
    const row = await StorageService.getLinkReceiver(OWNER);
    expect(row?.markerPublished).toBe(true);
    expect(row?.receiverRole).toBe("active");
    expect(row?.receiverPath).toBe(LINK_RECEIVER_PATH);
  });

  it("fails fast when publishReceiverMarker hangs", async () => {
    expect(RECEIVER_MARKER_PUBLISH_BUDGET_MS).toBe(15_000);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      generateNoiseSecretKey.mockResolvedValue(new Uint8Array(32).fill(7));
      noisePublicKeyFromSecret.mockResolvedValue("noise-pk-z32");
      publishReceiverMarker.mockImplementation(() => new Promise(() => {}));
      const pending = provisionReceiver({ pubky: () => OWNER } as never, OWNER);
      await waitForPublishToStart();
      let settled = false;
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(14_900);
      await Promise.resolve();
      expect(settled).toBe(false);
      const assertion = expect(pending).rejects.toMatchObject({
        name: "SessionResumeTimeout",
      });
      await vi.advanceTimersByTimeAsync(200);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no receiver evidence behind when the publish times out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      generateNoiseSecretKey.mockResolvedValue(new Uint8Array(32).fill(7));
      noisePublicKeyFromSecret.mockResolvedValue("noise-pk-z32");
      publishReceiverMarker.mockImplementation(() => new Promise(() => {}));
      const pending = provisionReceiver({ pubky: () => OWNER } as never, OWNER);
      await waitForPublishToStart();
      let settled = false;
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(14_900);
      await Promise.resolve();
      expect(settled).toBe(false);
      const assertion = expect(pending).rejects.toMatchObject({
        name: "SessionResumeTimeout",
      });
      await vi.advanceTimersByTimeAsync(200);
      await assertion;
    } finally {
      vi.useRealTimers();
    }

    // A surviving secret would read as "enabled" forever with no marker
    // published, because the status lookup falls back to this alias.
    expect(await KeyStore.getReceiverNoiseSecret(LINK_RECEIVER_PATH)).toBeNull();
    expect(await StorageService.getLinkReceiver(OWNER)).toBeNull();
  });

  it("leaves no receiver evidence behind when the publish rejects", async () => {
    generateNoiseSecretKey.mockResolvedValue(new Uint8Array(32).fill(7));
    noisePublicKeyFromSecret.mockResolvedValue("noise-pk-z32");
    publishReceiverMarker.mockRejectedValue(new Error("homeserver refused"));

    await expect(
      provisionReceiver({ pubky: () => OWNER } as never, OWNER),
    ).rejects.toThrow("homeserver refused");

    expect(await KeyStore.getReceiverNoiseSecret(LINK_RECEIVER_PATH)).toBeNull();
    expect(await StorageService.getLinkReceiver(OWNER)).toBeNull();
  });

  it("can be re-run after a failed publish and lands a fresh marker", async () => {
    generateNoiseSecretKey.mockResolvedValue(new Uint8Array(32).fill(7));
    noisePublicKeyFromSecret.mockResolvedValue("noise-pk-first");
    publishReceiverMarker.mockRejectedValueOnce(new Error("homeserver refused"));
    await expect(
      provisionReceiver({ pubky: () => OWNER } as never, OWNER),
    ).rejects.toThrow("homeserver refused");

    const fresh = new Uint8Array(32).fill(8);
    const persisted = new Uint8Array(fresh);
    generateNoiseSecretKey.mockResolvedValue(fresh);
    noisePublicKeyFromSecret.mockResolvedValue("noise-pk-second");
    publishReceiverMarker.mockResolvedValue(undefined);

    const result = await provisionReceiver({ pubky: () => OWNER } as never, OWNER);

    expect(result.noisePublicKey).toBe("noise-pk-second");
    expect(generateNoiseSecretKey).toHaveBeenCalledTimes(2);
    expect(await KeyStore.getReceiverNoiseSecret(LINK_RECEIVER_PATH)).toEqual(
      persisted,
    );
    const row = await StorageService.getLinkReceiver(OWNER);
    expect(row?.markerPublished).toBe(true);
  });

  it("keeps a published receiver when a re-publish fails", async () => {
    const persisted = new Uint8Array(32).fill(9);
    await KeyStore.setPubky(OWNER);
    await KeyStore.setReceiverNoiseSecret(LINK_RECEIVER_PATH, persisted);
    await StorageService.upsertLinkReceiver({
      ownerPubky: OWNER,
      receiverAlias: LINK_RECEIVER_PATH,
      receiverPath: LINK_RECEIVER_PATH,
      markerPublished: true,
    });
    noisePublicKeyFromSecret.mockResolvedValue("noise-pk-re");
    publishReceiverMarker.mockRejectedValue(new Error("homeserver refused"));

    await expect(
      provisionReceiver({ pubky: () => OWNER } as never, OWNER),
    ).rejects.toThrow("homeserver refused");

    // The marker on the homeserver still points at this key, so discarding it
    // would break a receiver that works.
    expect(await KeyStore.getReceiverNoiseSecret(LINK_RECEIVER_PATH)).toEqual(
      persisted,
    );
    expect((await StorageService.getLinkReceiver(OWNER))?.markerPublished).toBe(true);
  });

  it("rolls back a reused receiver whose marker never landed", async () => {
    await KeyStore.setPubky(OWNER);
    await KeyStore.setReceiverNoiseSecret(LINK_RECEIVER_PATH, new Uint8Array(32).fill(9));
    await StorageService.upsertLinkReceiver({
      ownerPubky: OWNER,
      receiverAlias: LINK_RECEIVER_PATH,
      receiverPath: LINK_RECEIVER_PATH,
      markerPublished: false,
    });
    noisePublicKeyFromSecret.mockResolvedValue("noise-pk-re");
    publishReceiverMarker.mockRejectedValue(new Error("homeserver refused"));

    await expect(
      provisionReceiver({ pubky: () => OWNER } as never, OWNER),
    ).rejects.toThrow("homeserver refused");

    expect(await KeyStore.getReceiverNoiseSecret(LINK_RECEIVER_PATH)).toBeNull();
    expect(await StorageService.getLinkReceiver(OWNER)).toBeNull();
  });

  it("zeroizes the re-derived receiver secret after publishing", async () => {
    const persisted = new Uint8Array(32).fill(9);
    await KeyStore.setPubky(OWNER);
    await KeyStore.setReceiverNoiseSecret(LINK_RECEIVER_PATH, persisted);
    await StorageService.upsertLinkReceiver({
      ownerPubky: OWNER,
      receiverAlias: LINK_RECEIVER_PATH,
      receiverPath: LINK_RECEIVER_PATH,
      markerPublished: false,
    });
    const derived = new Uint8Array(persisted);
    const spy = vi
      .spyOn(KeyStore, "getReceiverNoiseSecret")
      .mockResolvedValueOnce(derived);
    noisePublicKeyFromSecret.mockResolvedValue("noise-pk-re");
    publishReceiverMarker.mockResolvedValue(undefined);

    try {
      await provisionReceiver({ pubky: () => OWNER } as never, OWNER);
      expect(derived).toEqual(new Uint8Array(32));
      expect(generateNoiseSecretKey).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("mismatch + GET ok → no publish + standby", async () => {
    generateNoiseSecretKey.mockResolvedValue(new Uint8Array(32).fill(7));
    noisePublicKeyFromSecret.mockResolvedValue("local-pk");
    getReceiverMarker.mockResolvedValue({ noisePublicKey: "foreign-pk", capabilitiesJson: "{}" });
    const result = await provisionReceiver({ pubky: () => OWNER } as never, OWNER);
    expect(result.receiverRole).toBe("standby");
    expect(publishReceiverMarker).not.toHaveBeenCalled();
    expect((await StorageService.getLinkReceiver(OWNER))?.receiverRole).toBe("standby");
  });

  it("GET throw → no publish", async () => {
    generateNoiseSecretKey.mockResolvedValue(new Uint8Array(32).fill(7));
    noisePublicKeyFromSecret.mockResolvedValue("local-pk");
    getReceiverMarker.mockRejectedValue(new Error("homeserver down"));
    await expect(provisionReceiver({ pubky: () => OWNER } as never, OWNER)).rejects.toThrow(
      "homeserver down",
    );
    expect(publishReceiverMarker).not.toHaveBeenCalled();
    expect(await StorageService.getLinkReceiver(OWNER)).toBeNull();
  });

  it("first enable with foreign pk → pending confirm, no PUT", async () => {
    generateNoiseSecretKey.mockResolvedValue(new Uint8Array(32).fill(7));
    noisePublicKeyFromSecret.mockResolvedValue("local-pk");
    getReceiverMarker.mockResolvedValue({ noisePublicKey: "other-device", capabilitiesJson: "{}" });
    await provisionReceiver({ pubky: () => OWNER } as never, OWNER);
    expect(publishReceiverMarker).not.toHaveBeenCalled();
    expect((await StorageService.getLinkReceiver(OWNER))?.markerPublished).toBe(false);
  });

  it("takeover → exactly one PUT + active", async () => {
    generateNoiseSecretKey.mockResolvedValue(new Uint8Array(32).fill(7));
    noisePublicKeyFromSecret.mockResolvedValue("local-pk");
    getReceiverMarker.mockResolvedValue({ noisePublicKey: "foreign-pk", capabilitiesJson: "{}" });
    await provisionReceiver({ pubky: () => OWNER } as never, OWNER);
    publishReceiverMarker.mockClear();
    publishReceiverMarker.mockResolvedValue(undefined);
    const result = await takeoverReceiver({ pubky: () => OWNER } as never, OWNER);
    expect(result.receiverRole).toBe("active");
    expect(publishReceiverMarker).toHaveBeenCalledTimes(1);
    expect((await StorageService.getLinkReceiver(OWNER))?.receiverRole).toBe("active");
  });
});
