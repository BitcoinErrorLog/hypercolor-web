import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getContact = vi.fn();
const upsertContact = vi.fn();
const user = vi.fn();

vi.mock("@/services/StorageService", () => ({
  StorageService: {
    getContact: (...args: unknown[]) => getContact(...args),
    upsertContact: (...args: unknown[]) => upsertContact(...args),
  },
}));

vi.mock("@/services/NexusClient", () => ({
  createNexusClient: () => ({
    user: (...args: unknown[]) => user(...args),
  }),
}));

import { addManualContact } from "./addManualContact";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

describe("addManualContact", () => {
  beforeEach(() => {
    getContact.mockReset();
    upsertContact.mockReset();
    user.mockReset();
    getContact.mockResolvedValue(null);
    upsertContact.mockResolvedValue(undefined);
    user.mockResolvedValue({ ok: true, value: { details: { name: "Ada" } } });
  });

  it("rejects an invalid pubky", async () => {
    const result = await addManualContact(OWNER, "not-a-pubky");
    expect(result.ok).toBe(false);
    expect(upsertContact).not.toHaveBeenCalled();
    expect(user).not.toHaveBeenCalled();
  });

  it("rejects adding yourself", async () => {
    const result = await addManualContact(OWNER, OWNER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("self");
    expect(user).not.toHaveBeenCalled();
  });

  it("adds a raw pubky with no Nexus request", async () => {
    getContact.mockResolvedValueOnce(null).mockResolvedValueOnce({
      pubky: PEER,
      ownerPubky: OWNER,
      trustScore: 0,
      isFollowing: false,
      isFollower: false,
      isMutual: false,
      addedManually: true,
      firstSeenAt: 1,
    });
    const result = await addManualContact(OWNER, `pubky://${PEER}`);
    expect(result.ok).toBe(true);
    expect(user).not.toHaveBeenCalled();
    expect(upsertContact).toHaveBeenCalledOnce();
    const written = upsertContact.mock.calls[0]?.[0] as { addedManually: boolean; displayName?: string };
    expect(written.addedManually).toBe(true);
    expect(written.displayName).toBeUndefined();
  });

  it("reuses a display name from the search hit and still does not call Nexus", async () => {
    getContact.mockResolvedValueOnce(null).mockResolvedValueOnce({
      pubky: PEER,
      ownerPubky: OWNER,
      displayName: "Ada",
      trustScore: 0,
      isFollowing: false,
      isFollower: false,
      isMutual: false,
      addedManually: true,
      firstSeenAt: 1,
    });
    const result = await addManualContact(OWNER, PEER, { displayName: "Ada" });
    expect(result.ok).toBe(true);
    expect(user).not.toHaveBeenCalled();
    const written = upsertContact.mock.calls[0]?.[0] as { displayName?: string };
    expect(written.displayName).toBe("Ada");
  });

  it("contains no Nexus client import", () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "addManualContact.ts"),
      "utf8",
    );
    expect(source).not.toContain("NexusClient");
    expect(source).not.toContain("createNexusClient");
    expect(source).not.toContain("nexus.user");
  });
});
