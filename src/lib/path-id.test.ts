import { describe, expect, it } from "vitest";
import { readPathId } from "./path-id";

describe("path-id", () => {
  it("reads an encoded conversation id from the chats path", () => {
    expect(readPathId("chats", "/chats/dm%3Aabc")).toBe("dm:abc");
    expect(readPathId("chats", "/chats")).toBeNull();
    expect(readPathId("channels", "/chats/x")).toBeNull();
  });
});
