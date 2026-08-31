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
      "a0937be84efffe2a1be08aef3cbe2f541588a4ca",
    );
    expect(HYPERCOLOR_WIRE_REPO).toContain("BitcoinErrorLog/hypercolor");
  });
});
