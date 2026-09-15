import { describe, expect, it } from "vitest";
import {
  NEXUS_MAX_BODY_BYTES,
  parseNexusJson,
  readNexusResponseText,
  utf8ByteLength,
} from "./nexus-http";

describe("nexus-http", () => {
  it("rejects a body over the byte cap from content-length", async () => {
    const response = new Response("{}", {
      headers: { "content-length": String(NEXUS_MAX_BODY_BYTES + 1) },
    });
    expect(await readNexusResponseText(response)).toEqual({ ok: false, reason: "too-large" });
  });

  it("rejects a streamed body after the byte cap", async () => {
    const huge = "x".repeat(NEXUS_MAX_BODY_BYTES + 8);
    const response = new Response(huge, { headers: { "content-type": "text/plain" } });
    expect(await readNexusResponseText(response)).toEqual({ ok: false, reason: "too-large" });
  });

  it("parses JSON under the cap and reports invalid JSON", () => {
    expect(parseNexusJson(`{"ok":true}`)).toEqual({ ok: true, value: { ok: true } });
    expect(parseNexusJson("not-json")).toEqual({ ok: false, reason: "not-json" });
    expect(utf8ByteLength("ab")).toBe(2);
  });
});
