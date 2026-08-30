import { describe, expect, it } from "vitest";
import {
  capabilitiesCoverHypercolorRw,
  extractCapabilitySpecsFromExport,
  parseCapabilitySpec,
  scopeCovers,
} from "./capabilities";

describe("capabilitiesCoverHypercolorRw", () => {
  it("accepts the combined Ring grant and parent directories", () => {
    expect(
      capabilitiesCoverHypercolorRw([
        "/pub/paykit/:rw",
        "/pub/hypercolor.app/v1/:rw",
      ]),
    ).toBe(true);
    expect(capabilitiesCoverHypercolorRw(["/pub/:rw"])).toBe(true);
    expect(capabilitiesCoverHypercolorRw(["/:rw"])).toBe(true);
  });

  it("rejects paykit-only and read-only grants", () => {
    expect(capabilitiesCoverHypercolorRw(["/pub/paykit/:rw"])).toBe(false);
    expect(capabilitiesCoverHypercolorRw(["/pub/hypercolor.app/v1/:r"])).toBe(
      false,
    );
    expect(
      capabilitiesCoverHypercolorRw([
        "/pub/hypercolor.app/v1/:r",
        "/pub/:w",
      ]),
    ).toBe(false);
  });

  it("does not treat a file-scope sibling as covering the tree", () => {
    expect(scopeCovers("/pub/hypercolor.app/v1", "/pub/hypercolor.app/v1/")).toBe(
      false,
    );
    expect(parseCapabilitySpec("/pub/hypercolor.app/v1/:rw")?.scope).toBe(
      "/pub/hypercolor.app/v1/",
    );
  });

  it("extracts capability specs from a base64 export blob", () => {
    const exported = btoa("xx/pub/paykit/:rw,/pub/hypercolor.app/v1/:rwy");
    const specs = extractCapabilitySpecsFromExport(exported);
    expect(specs).toContain("/pub/paykit/:rw");
    expect(specs).toContain("/pub/hypercolor.app/v1/:rw");
    expect(capabilitiesCoverHypercolorRw(specs)).toBe(true);
  });
});
