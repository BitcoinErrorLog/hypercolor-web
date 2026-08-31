import { describe, expect, it, vi } from "vitest";
import { pushAppPath, readPathId } from "./path-id";

describe("path-id", () => {
  it("reads an encoded conversation id from the chats path", () => {
    expect(readPathId("chats", "/chats/dm%3Aabc")).toBe("dm:abc");
    expect(readPathId("chats", "/chats")).toBeNull();
    expect(readPathId("channels", "/chats/x")).toBeNull();
  });

  it("updates the path without starting a document navigation", () => {
    const pushState = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      history: { pushState },
      dispatchEvent,
    });
    try {
      pushAppPath("/chats");
      pushAppPath("/chats/dm:peer");
      expect(pushState).toHaveBeenNthCalledWith(1, { __NA: true }, "", "/chats");
      expect(pushState).toHaveBeenNthCalledWith(2, { __NA: true }, "", "/chats/dm:peer");
      expect(pushState).not.toHaveBeenCalledWith(null, "", "/chats");
      expect(dispatchEvent).toHaveBeenCalledTimes(2);
      expect((dispatchEvent.mock.calls[0]?.[0] as Event).type).toBe("popstate");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
