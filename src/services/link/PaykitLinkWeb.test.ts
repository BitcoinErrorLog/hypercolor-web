import { describe, expect, it, vi } from "vitest";
import { PaykitLinkWeb } from "./PaykitLinkWeb";

describe("PaykitLinkWeb cookie rule", () => {
  it("putPublic forwards path and bytes only", async () => {
    const putPublic = vi.fn(async () => undefined);
    const session = { putPublic };
    await PaykitLinkWeb.putPublic(
      session as never,
      "/pub/hypercolor.app/v1/doc.json",
      new Uint8Array([1, 2, 3]),
    );
    expect(putPublic).toHaveBeenCalledTimes(1);
    expect(putPublic).toHaveBeenCalledWith(
      "/pub/hypercolor.app/v1/doc.json",
      new Uint8Array([1, 2, 3]),
    );
  });
});
