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

vi.mock("./PaykitLinkWeb", () => ({
  PaykitLinkWeb: {
    generateNoiseSecretKey: (...args: unknown[]) => generateNoiseSecretKey(...args),
    noisePublicKeyFromSecret: (...args: unknown[]) =>
      noisePublicKeyFromSecret(...args),
    publishReceiverMarker: (...args: unknown[]) => publishReceiverMarker(...args),
  },
}));

import { provisionReceiver } from "./provisionReceiver";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

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
  });

  afterEach(() => {
    setDbForTests(null);
  });

  it("wraps the Noise secret and publishes a messaging-only marker", async () => {
    const secret = new Uint8Array(32).fill(7);
    generateNoiseSecretKey.mockResolvedValue(secret);
    noisePublicKeyFromSecret.mockResolvedValue("noise-pk-z32");
    publishReceiverMarker.mockResolvedValue(undefined);
    const session = { pubky: () => OWNER };

    const result = await provisionReceiver(session as never, OWNER);

    expect(result).toEqual({
      pubky: OWNER,
      receiverPath: LINK_RECEIVER_PATH,
      noisePublicKey: "noise-pk-z32",
    });
    expect(await KeyStore.getReceiverNoiseSecret(LINK_RECEIVER_PATH)).toEqual(
      secret,
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
    expect(row?.receiverPath).toBe(LINK_RECEIVER_PATH);
  });
});
