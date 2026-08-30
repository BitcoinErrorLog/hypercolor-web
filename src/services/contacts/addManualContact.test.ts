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
    user.mockResolvedValue({ ok: false, kind: "http", status: 404, message: "missing" });
  });

  it("rejects an invalid pubky", async () => {
    const result = await addManualContact(OWNER, "not-a-pubky");
    expect(result.ok).toBe(false);
    expect(upsertContact).not.toHaveBeenCalled();
  });

  it("rejects adding yourself", async () => {
    const result = await addManualContact(OWNER, OWNER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("self");
  });

  it("persists a manual contact and uses Nexus display name when present", async () => {
    user.mockResolvedValue({
      ok: true,
      value: { details: { name: "Ada" } },
    });
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
    const result = await addManualContact(OWNER, `pubky://${PEER}`);
    expect(result.ok).toBe(true);
    expect(upsertContact).toHaveBeenCalledOnce();
    const written = upsertContact.mock.calls[0]?.[0] as { addedManually: boolean; displayName?: string };
    expect(written.addedManually).toBe(true);
    expect(written.displayName).toBe("Ada");
  });
});
