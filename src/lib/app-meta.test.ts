import { describe, expect, it } from "vitest";
import {
  APP_NAME,
  HYPERCOLOR_WIRE_PIN,
  HYPERCOLOR_WIRE_REPO,
} from "./app-meta";

describe("app-meta", () => {
  it("names the product Hypercolor", () => {
    expect(APP_NAME).toBe("Hypercolor");
  });

  it("pins the mobile Encrypted Links contract", () => {
    expect(HYPERCOLOR_WIRE_PIN).toBe(
      "c7157aaa1b338dd1d8545e82f639007cba945631",
    );
    expect(HYPERCOLOR_WIRE_REPO).toContain("BitcoinErrorLog/hypercolor");
  });
});
