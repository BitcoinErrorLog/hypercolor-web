import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "session-bootstrap.tsx"),
  "utf8",
);

describe("SessionBootstrap apply-time re-read", () => {
  it("re-reads restore and enable immediately before setFromRestore", () => {
    expect(source).toContain("restoreNow = await restoreSessionOnLoad()");
    expect(source).toContain("enableNow = await getEnableStatus()");
    expect(source).toContain("setFromRestore(restoreNow, enableNow, { hasIdentity })");
    expect(source).toContain("dataset.hcRestore = restoreNow.status");
    expect(source).toContain("dataset.hcEnable = isEnableCompleted()");
    expect(source).toContain("isEnableCompleted()");
    expect(source).not.toContain('dataset.hcEnable = enableNow ?? \"\"');
    const applyIndex = source.indexOf("restoreNow = await restoreSessionOnLoad()");
    const setIndex = source.indexOf("setFromRestore(restoreNow, enableNow");
    expect(applyIndex).toBeGreaterThan(0);
    expect(setIndex).toBeGreaterThan(applyIndex);
  });
});
