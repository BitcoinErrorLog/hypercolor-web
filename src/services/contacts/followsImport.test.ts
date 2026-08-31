import { describe, expect, it } from "vitest";
import { createFollowsImporter, type FollowsImportDeps } from "./followsImport";
import type { Contact, PubkyKey } from "@/types";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const OTHER = "q1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const STRANGER = "r1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

function contact(pubky: PubkyKey, flags: Partial<Contact> = {}): Contact {
  return {
    pubky,
    ownerPubky: OWNER,
    trustScore: 0,
    isFollowing: false,
    isFollower: false,
    isMutual: false,
    addedManually: true,
    firstSeenAt: 1,
    ...flags,
  };
}

function deps(overrides: Partial<FollowsImportDeps> = {}): FollowsImportDeps & {
  calls: {
    following: number;
    followers: number;
    list: number;
    confirm: string[];
    upsert: Contact[];
    flags: Array<{ pubky: string; isFollowing: boolean; isFollower: boolean; isMutual: boolean }>;
  };
} {
  const calls = {
    following: 0,
    followers: 0,
    list: 0,
    confirm: [] as string[],
    upsert: [] as Contact[],
    flags: [] as Array<{
      pubky: string;
      isFollowing: boolean;
      isFollower: boolean;
      isMutual: boolean;
    }>,
  };
  const contacts: Contact[] = [];
  return {
    calls,
    isEnabled: overrides.isEnabled ?? (() => true),
    listOwnFollows: async (owner) => {
      calls.list += 1;
      return overrides.listOwnFollows
        ? overrides.listOwnFollows(owner)
        : { ok: true, pubkys: [] };
    },
    confirmFollow: async (owner, peer) => {
      calls.confirm.push(peer);
      return overrides.confirmFollow ? overrides.confirmFollow(owner, peer) : false;
    },
    following: async (pubky, query) => {
      calls.following += 1;
      return overrides.following
        ? overrides.following(pubky, query)
        : { ok: true, value: [] };
    },
    followers: async (pubky, query) => {
      calls.followers += 1;
      return overrides.followers
        ? overrides.followers(pubky, query)
        : { ok: true, value: [] };
    },
    getAllContacts: overrides.getAllContacts ?? (async () => contacts),
    upsertContact: async (row) => {
      calls.upsert.push(row);
      await overrides.upsertContact?.(row);
      contacts.push(row);
    },
    setContactRelationshipFlags: async (owner, pubky, flags) => {
      calls.flags.push({ pubky, ...flags });
      await overrides.setContactRelationshipFlags?.(owner, pubky, flags);
    },
  };
}

describe("followsImport", () => {
  it("does nothing when opt-in is off — no Nexus, no homeserver list", async () => {
    const d = deps({ isEnabled: () => false });
    const result = await createFollowsImporter(d).importFollows(OWNER);
    expect(result).toEqual({ ok: true, skipped: true, reason: "opt-in-off" });
    expect(d.calls.list).toBe(0);
    expect(d.calls.following).toBe(0);
    expect(d.calls.followers).toBe(0);
    expect(d.calls.upsert).toEqual([]);
    expect(d.calls.flags).toEqual([]);
  });

  it("imports homeserver follows as suggestions and does not add followers-only strangers", async () => {
    const existing = [contact(PEER)];
    const d = deps({
      getAllContacts: async () => existing,
      listOwnFollows: async () => ({ ok: true, pubkys: [PEER, OTHER] }),
      followers: async () => ({ ok: true, value: [STRANGER] }),
    });
    const result = await createFollowsImporter(d).importFollows(OWNER);
    expect(result.ok && !result.skipped && result.source === "homeserver").toBe(true);
    expect(d.calls.following).toBe(0);
    expect(d.calls.flags).toEqual([
      { pubky: PEER, isFollowing: true, isFollower: false, isMutual: false },
    ]);
    expect(d.calls.upsert).toHaveLength(1);
    expect(d.calls.upsert[0]?.pubky).toBe(OTHER);
    expect(d.calls.upsert[0]?.addedManually).toBe(false);
    expect(d.calls.upsert[0]?.isFollowing).toBe(true);
    expect(d.calls.upsert.map((row) => row.pubky)).not.toContain(STRANGER);
  });

  it("does not set isFollowing from a fake Nexus follow without homeserver confirm", async () => {
    const existing = [contact(PEER)];
    const d = deps({
      getAllContacts: async () => existing,
      listOwnFollows: async () => ({ ok: false, kind: "network", message: "denied" }),
      following: async () => ({ ok: true, value: [PEER] }),
      confirmFollow: async () => false,
    });
    const result = await createFollowsImporter(d).importFollows(OWNER);
    expect(result.ok && !result.skipped).toBe(true);
    if (result.ok && !result.skipped) {
      expect(result.source).toBe("nexus-confirmed");
      expect(result.confirmedCount).toBe(0);
    }
    expect(d.calls.confirm).toEqual([PEER]);
    expect(d.calls.upsert).toEqual([]);
    expect(d.calls.flags).toEqual([]);
  });

  it("uses Nexus following only after homeserver list fails, then confirms each file", async () => {
    const d = deps({
      listOwnFollows: async () => ({ ok: false, kind: "network", message: "denied" }),
      following: async () => ({ ok: true, value: [PEER] }),
      confirmFollow: async () => true,
    });
    const result = await createFollowsImporter(d).importFollows(OWNER);
    expect(result.ok && !result.skipped && result.source === "nexus-confirmed").toBe(true);
    expect(d.calls.following).toBe(1);
    expect(d.calls.confirm).toEqual([PEER]);
    expect(d.calls.upsert[0]?.pubky).toBe(PEER);
  });

  it("still imports when Nexus is down if the homeserver listing works", async () => {
    const d = deps({
      listOwnFollows: async () => ({ ok: true, pubkys: [PEER] }),
      following: async () => ({
        ok: false,
        kind: "network",
        status: null,
        message: "down",
      }),
    });
    const result = await createFollowsImporter(d).importFollows(OWNER);
    expect(result.ok && !result.skipped && result.confirmedCount === 1).toBe(true);
    expect(d.calls.following).toBe(0);
    expect(d.calls.upsert[0]?.pubky).toBe(PEER);
  });

  it("fails closed when both homeserver list and Nexus following fail", async () => {
    const d = deps({
      listOwnFollows: async () => ({ ok: false, kind: "network", message: "denied" }),
      following: async () => ({
        ok: false,
        kind: "network",
        status: null,
        message: "down",
      }),
    });
    const result = await createFollowsImporter(d).importFollows(OWNER);
    expect(result.ok).toBe(false);
    expect(d.calls.upsert).toEqual([]);
  });

  it("treats Nexus 404 following as an empty list, not an error", async () => {
    const d = deps({
      listOwnFollows: async () => ({ ok: false, kind: "network", message: "denied" }),
      following: async () => ({
        ok: false,
        kind: "http",
        status: 404,
        message: "missing",
      }),
    });
    const result = await createFollowsImporter(d).importFollows(OWNER);
    expect(result.ok && !result.skipped && result.confirmedCount === 0).toBe(true);
  });
});
