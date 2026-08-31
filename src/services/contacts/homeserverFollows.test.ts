import { describe, expect, it, vi } from "vitest";
import {
  followDocumentPath,
  parseFollowDocument,
  parseFollowsDirectoryListing,
  PUBKY_APP_FOLLOWS_DIR,
  createHomeserverFollows,
} from "./homeserverFollows";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("homeserverFollows", () => {
  it("parses a text/plain directory listing of follow URIs", () => {
    const listing = [
      `pubky://${OWNER}/pub/pubky.app/follows/${PEER}`,
      `pubky://${OWNER}/pub/pubky.app/follows/${PEER}`,
      "",
    ].join("\n");
    expect(parseFollowsDirectoryListing(listing)).toEqual([PEER]);
  });

  it("rejects a JSON body as a listing (that is a file, not a directory)", () => {
    expect(parseFollowsDirectoryListing(`{"created_at":1}`)).toBeNull();
  });

  it("accepts a follow document only when created_at is a number", () => {
    expect(parseFollowDocument(`{"created_at":1627849723}`)).toEqual({ createdAt: 1627849723 });
    expect(parseFollowDocument(`{"created_at":"no"}`)).toBeNull();
    expect(parseFollowDocument(`not-json`)).toBeNull();
  });

  it("lists own follows via publicGet of the directory and never writes", async () => {
    const publicGet = vi.fn().mockResolvedValue(
      bytes(`pubky://${OWNER}/pub/pubky.app/follows/${PEER}`),
    );
    const hs = createHomeserverFollows({ publicGet });
    const result = await hs.listOwnFollows(OWNER);
    expect(result).toEqual({ ok: true, pubkys: [PEER] });
    expect(publicGet).toHaveBeenCalledWith(OWNER, PUBKY_APP_FOLLOWS_DIR);
  });

  it("treats a missing directory as an empty follow list", async () => {
    const hs = createHomeserverFollows({ publicGet: vi.fn().mockResolvedValue(undefined) });
    expect(await hs.listOwnFollows(OWNER)).toEqual({ ok: true, pubkys: [] });
  });

  it("returns network when publicGet throws", async () => {
    const hs = createHomeserverFollows({
      publicGet: vi.fn().mockRejectedValue(new Error("homeserver down")),
    });
    const result = await hs.listOwnFollows(OWNER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("network");
  });

  it("confirms a follow only when the document parses", async () => {
    const publicGet = vi
      .fn()
      .mockResolvedValueOnce(bytes(`{"created_at":1}`))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(bytes(`{"nope":true}`));
    const hs = createHomeserverFollows({ publicGet });
    expect(await hs.confirmFollow(OWNER, PEER)).toBe(true);
    expect(publicGet).toHaveBeenCalledWith(OWNER, followDocumentPath(PEER));
    expect(await hs.confirmFollow(OWNER, PEER)).toBe(false);
    expect(await hs.confirmFollow(OWNER, PEER)).toBe(false);
  });

  it("does not GET a traversal-shaped peer path", async () => {
    const publicGet = vi.fn();
    const hs = createHomeserverFollows({ publicGet });
    expect(await hs.confirmFollow(OWNER, "../secrets")).toBe(false);
    expect(await hs.confirmFollow(OWNER, "not/a/pubky")).toBe(false);
    expect(publicGet).not.toHaveBeenCalled();
  });
});
