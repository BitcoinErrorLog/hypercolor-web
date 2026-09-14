import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDbForTests } from "@/db";
import { openMemoryDb } from "@/db/__tests__/betterSqliteAdapter";
import { runMigrations } from "@/db/migrations";
import { StorageService } from "@/services/StorageService";
import { capabilityPath, LEGACY_RECEIVER_JSON_STORAGE_PATH } from "@/types/receiverMarker";

const publicGet = vi.fn();
const putPublic = vi.fn();
const getReceiverMarker = vi.fn();
vi.mock("./PaykitLinkWeb", () => ({
  PaykitLinkWeb: {
    publicGet: (...args: unknown[]) => publicGet(...args),
    putPublic: (...args: unknown[]) => putPublic(...args),
    getReceiverMarker: (...args: unknown[]) => getReceiverMarker(...args),
  },
}));

import {
  ensureChatKindsVReceiverJson,
  persistPeerChatKindsVFromMarker,
  resolvePeerChatKindsV,
} from "./chatKindsAdvertisement";

const OWNER = "owner";
const PEER = "peer";
const PK = "noise";
const marker = { noisePublicKey: PK };
const valid = new TextEncoder().encode(
  '{"version":1,"kind":"hypercolor.receiver.capabilities","receiver_path":"hypercolor/wallet","chat_kinds_v":1}',
);

describe("key-bound Hypercolor capability discovery", () => {
  beforeEach(async () => {
    const db = openMemoryDb();
    await runMigrations(db);
    setDbForTests(db);
    publicGet.mockReset();
    putPublic.mockReset().mockResolvedValue(undefined);
    getReceiverMarker.mockReset().mockResolvedValue(marker);
  });
  afterEach(() => setDbForTests(null));

  it("uses a valid new document and never reads legacy", async () => {
    publicGet.mockResolvedValue(valid);
    await expect(resolvePeerChatKindsV(PEER, marker)).resolves.toBe(1);
    expect(publicGet).toHaveBeenCalledWith(PEER, capabilityPath(PK));
    expect(publicGet).not.toHaveBeenCalledWith(PEER, LEGACY_RECEIVER_JSON_STORAGE_PATH);
  });

  it("falls back to legacy only when the new document is absent", async () => {
    publicGet.mockImplementation(async (_peer: string, path: string) =>
      path === capabilityPath(PK) ? undefined : new TextEncoder().encode('{"chat_kinds_v":1,"noise_public_key":"ignored"}'),
    );
    await expect(resolvePeerChatKindsV(PEER, marker)).resolves.toBe(1);
    expect(publicGet).toHaveBeenCalledWith(PEER, LEGACY_RECEIVER_JSON_STORAGE_PATH);
  });

  it("does not fall back for malformed new data", async () => {
    publicGet.mockResolvedValue(new TextEncoder().encode('{"chat_kinds_v":1}'));
    await expect(resolvePeerChatKindsV(PEER, marker)).resolves.toBe(0);
    expect(publicGet).toHaveBeenCalledTimes(1);
  });

  it("does not treat an empty new document as absent", async () => {
    publicGet.mockResolvedValue(new Uint8Array());
    await expect(resolvePeerChatKindsV(PEER, marker)).resolves.toBe(0);
    expect(publicGet).toHaveBeenCalledTimes(1);
  });

  it("preserves a stored v1 on capability transport failure", async () => {
    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "initiator",
      status: "established",
      snapshot: "snapshot",
      remoteNoisePublicKey: PK,
      localReceiverPath: "hypercolor/wallet",
      remoteReceiverPath: "hypercolor/wallet",
      consecutiveFailures: 0,
      chatKindsV: 1,
    });
    publicGet.mockRejectedValue(new Error("network"));
    await expect(resolvePeerChatKindsV(PEER, marker, OWNER)).resolves.toBe(1);
  });

  it("preserves stored v1 when legacy fallback is unavailable", async () => {
    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "initiator",
      status: "established",
      snapshot: "snapshot",
      remoteNoisePublicKey: PK,
      localReceiverPath: "hypercolor/wallet",
      remoteReceiverPath: "hypercolor/wallet",
      consecutiveFailures: 0,
      chatKindsV: 1,
    });
    publicGet.mockImplementation(async (_peer: string, path: string) => {
      if (path === capabilityPath(PK)) return undefined;
      throw new Error("legacy network failure");
    });
    const persist = vi.spyOn(StorageService, "recordPeerChatKindsV");

    await expect(persistPeerChatKindsVFromMarker(OWNER, PEER, marker, vi.fn())).resolves.toBe(1);
    expect((await StorageService.getLink(OWNER, PEER))?.chatKindsV).toBe(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it("preserves stored v1 when legacy fallback is malformed", async () => {
    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "initiator",
      status: "established",
      snapshot: "snapshot",
      remoteNoisePublicKey: PK,
      localReceiverPath: "hypercolor/wallet",
      remoteReceiverPath: "hypercolor/wallet",
      consecutiveFailures: 0,
      chatKindsV: 1,
    });
    publicGet.mockImplementation(async (_peer: string, path: string) =>
      path === capabilityPath(PK) ? undefined : new TextEncoder().encode('{"chat_kinds_v":'),
    );
    const persist = vi.spyOn(StorageService, "recordPeerChatKindsV");

    await expect(persistPeerChatKindsVFromMarker(OWNER, PEER, marker, vi.fn())).resolves.toBe(1);
    expect((await StorageService.getLink(OWNER, PEER))?.chatKindsV).toBe(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it("preserves stored v1 when legacy fallback has duplicate keys", async () => {
    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "initiator",
      status: "established",
      snapshot: "snapshot",
      remoteNoisePublicKey: PK,
      localReceiverPath: "hypercolor/wallet",
      remoteReceiverPath: "hypercolor/wallet",
      consecutiveFailures: 0,
      chatKindsV: 1,
    });
    publicGet.mockImplementation(async (_peer: string, path: string) =>
      path === capabilityPath(PK)
        ? undefined
        : new TextEncoder().encode('{"chat_kinds_v":1,"chat_kinds_v":0}'),
    );
    const persist = vi.spyOn(StorageService, "recordPeerChatKindsV");

    await expect(persistPeerChatKindsVFromMarker(OWNER, PEER, marker, vi.fn())).resolves.toBe(1);
    expect((await StorageService.getLink(OWNER, PEER))?.chatKindsV).toBe(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it("persists zero when legacy fallback is parseable without chat_kinds_v", async () => {
    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "initiator",
      status: "established",
      snapshot: "snapshot",
      remoteNoisePublicKey: PK,
      localReceiverPath: "hypercolor/wallet",
      remoteReceiverPath: "hypercolor/wallet",
      consecutiveFailures: 0,
      chatKindsV: 1,
    });
    publicGet.mockImplementation(async (_peer: string, path: string) =>
      path === capabilityPath(PK) ? undefined : new TextEncoder().encode('{"noise_public_key":"ignored"}'),
    );

    await expect(persistPeerChatKindsVFromMarker(OWNER, PEER, marker, vi.fn())).resolves.toBe(0);
    expect((await StorageService.getLink(OWNER, PEER))?.chatKindsV).toBe(0);
  });

  it("persists zero when new is absent and legacy is absent", async () => {
    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "initiator",
      status: "established",
      snapshot: "snapshot",
      remoteNoisePublicKey: PK,
      localReceiverPath: "hypercolor/wallet",
      remoteReceiverPath: "hypercolor/wallet",
      consecutiveFailures: 0,
      chatKindsV: 1,
    });
    publicGet.mockResolvedValue(undefined);

    await expect(persistPeerChatKindsVFromMarker(OWNER, PEER, marker, vi.fn())).resolves.toBe(0);
    expect((await StorageService.getLink(OWNER, PEER))?.chatKindsV).toBe(0);
  });

  it("rechecks the typed marker before capability PUT", async () => {
    publicGet.mockResolvedValueOnce(undefined).mockResolvedValue(valid);
    await ensureChatKindsVReceiverJson({ pubky: () => OWNER } as never, OWNER, "hypercolor/wallet", PK);
    expect(putPublic).toHaveBeenCalledWith(
      expect.anything(),
      capabilityPath(PK),
      expect.any(Uint8Array),
    );
  });

  it("retains a failure when a post-PUT marker reconciliation changes the key", async () => {
    publicGet.mockResolvedValueOnce(undefined).mockResolvedValue(valid);
    getReceiverMarker.mockResolvedValueOnce(marker).mockResolvedValue({ noisePublicKey: "other" });
    await expect(
      ensureChatKindsVReceiverJson({ pubky: () => OWNER } as never, OWNER, "hypercolor/wallet", PK),
    ).rejects.toThrow("not confirmed");
  });

  it("rejects a stale marker without writing the capability", async () => {
    getReceiverMarker.mockResolvedValue({ noisePublicKey: "other" });
    await expect(
      ensureChatKindsVReceiverJson({ pubky: () => OWNER } as never, OWNER, "hypercolor/wallet", PK),
    ).rejects.toThrow("changed");
    expect(putPublic).not.toHaveBeenCalled();
  });

  it("persists discovery and invokes an upgrade once", async () => {
    publicGet.mockResolvedValue(valid);
    await StorageService.upsertLink({
      ownerPubky: OWNER,
      peerPubky: PEER,
      role: "initiator",
      status: "handshaking",
      snapshot: "snapshot",
      remoteNoisePublicKey: PK,
      localReceiverPath: "hypercolor/wallet",
      remoteReceiverPath: "hypercolor/wallet",
      consecutiveFailures: 0,
    });
    const onUpgrade = vi.fn(async () => undefined);
    await persistPeerChatKindsVFromMarker(OWNER, PEER, marker, onUpgrade);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect((await StorageService.getLink(OWNER, PEER))?.chatKindsV).toBe(1);
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });
});
