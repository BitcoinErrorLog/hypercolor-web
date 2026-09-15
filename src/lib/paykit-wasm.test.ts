import { describe, expect, it } from "vitest";
import { loadPaykitWasm } from "./paykit-wasm";

describe("loadPaykitWasm", () => {
  it("refuses to initialize outside a browser", async () => {
    await expect(loadPaykitWasm()).rejects.toThrow(/browser/);
  });
});
