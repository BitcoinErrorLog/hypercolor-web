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
      "6185a6a8e6bf3a52831515cb85131a7020704396",
    );
    expect(HYPERCOLOR_WIRE_REPO).toContain("BitcoinErrorLog/hypercolor");
  });
});
