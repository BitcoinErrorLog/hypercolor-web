import { describe, expect, it } from "vitest";
import { validateAttachFile } from "./attach-file";

describe("attach validation", () => {
  it("rejects oversized and blocked types", () => {
    const big = new File([new Uint8Array(9 * 1024 * 1024)], "x.png", { type: "image/png" });
    expect(validateAttachFile(big).ok).toBe(false);
    const html = new File(["<script>"], "x.html", { type: "text/html" });
    expect(validateAttachFile(html).ok).toBe(false);
    const ok = new File([new Uint8Array(16)], "x.png", { type: "image/png" });
    expect(validateAttachFile(ok).ok).toBe(true);
  });
});
