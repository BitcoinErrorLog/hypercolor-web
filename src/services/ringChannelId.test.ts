import { describe, expect, it } from "vitest";
import { formatRingVerificationCode } from "./ringChannelId";

describe("formatRingVerificationCode", () => {
  it("groups the first six characters of a known ch as XXX-XXX", () => {
    expect(
      formatRingVerificationCode("8eOwP5zDIW4PwXitMsHu3RdUDCF60o3DTwI-firPVT8"),
    ).toBe("8eO-wP5");
  });
});
