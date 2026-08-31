import { describe, expect, it, vi } from "vitest";
import { createUsernameSearch } from "./usernameSearch";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

describe("usernameSearch", () => {
  it("treats a pasted pubky as identity, not a Nexus username query", async () => {
    const searchUsersByName = vi.fn();
    const user = vi.fn();
    const result = await createUsernameSearch({ searchUsersByName, user }).search(
      `pubky://${PEER}`,
    );
    expect(result).toEqual({ ok: true, kind: "pubky", pubky: PEER });
    expect(searchUsersByName).not.toHaveBeenCalled();
    expect(user).not.toHaveBeenCalled();
  });

  it("rejects empty, short, and path-like input without calling Nexus", async () => {
    const searchUsersByName = vi.fn();
    const search = createUsernameSearch({ searchUsersByName, user: vi.fn() });
    expect((await search.search("")).ok).toBe(false);
    expect((await search.search("a")).ok).toBe(false);
    expect((await search.search("ada/../x")).ok).toBe(false);
    expect(searchUsersByName).not.toHaveBeenCalled();
  });

  it("returns matches with names when Nexus is healthy", async () => {
    const searchUsersByName = vi.fn().mockResolvedValue({ ok: true, value: [PEER, OWNER] });
    const user = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { details: { name: "Ada", bio: "dev" } } })
      .mockResolvedValueOnce({ ok: false });
    const result = await createUsernameSearch({ searchUsersByName, user }).search("Ada");
    expect(result.ok && result.kind === "matches").toBe(true);
    if (result.ok && result.kind === "matches") {
      expect(result.hits).toEqual([
        { pubky: PEER, name: "Ada", bio: "dev" },
        { pubky: OWNER, name: null, bio: null },
      ]);
    }
    expect(searchUsersByName).toHaveBeenCalledWith("Ada", { skip: 0, limit: 8 });
  });

  it("degrades when Nexus is down, empty, or malformed", async () => {
    const down = createUsernameSearch({
      searchUsersByName: vi.fn().mockResolvedValue({
        ok: false,
        kind: "network",
        status: null,
        message: "offline",
      }),
      user: vi.fn(),
    });
    const failed = await down.search("ada");
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.reason).toBe("nexus");

    const empty = createUsernameSearch({
      searchUsersByName: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      user: vi.fn(),
    });
    const none = await empty.search("zzz");
    expect(none).toEqual({ ok: true, kind: "matches", query: "zzz", hits: [] });
  });

  it("never puts a private identifier into the username query", async () => {
    const searchUsersByName = vi.fn().mockResolvedValue({ ok: true, value: [] });
    await createUsernameSearch({ searchUsersByName, user: vi.fn() }).search("ada");
    const [prefix, query] = searchUsersByName.mock.calls[0] ?? [];
    expect(prefix).toBe("ada");
    expect(query).toEqual({ skip: 0, limit: 8 });
    expect(JSON.stringify(searchUsersByName.mock.calls)).not.toContain("hypercolor.app");
    expect(JSON.stringify(searchUsersByName.mock.calls)).not.toContain("/group/");
  });
});
