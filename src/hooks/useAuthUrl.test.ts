import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "useAuthUrl.ts"),
  "utf8",
);

describe("useAuthUrl Enable approval contract", () => {
  it("reuses an in-flight flow by stored URL and never cancels after awaitApproval consumes the handle", () => {
    expect(source).toContain("let sharedFlow");
    expect(source).toContain("startInFlight");
    expect(source).toContain("existing.url");
    expect(source).toContain("if (!existing || existing.canceled) return false");
    expect(source).toContain("if (reuse()) return");
    expect(source).not.toContain("Handle was consumed; start a replacement flow below.");
    expect(source).not.toMatch(/authorizationUrl\(\)[\s\S]{0,200}start a replacement/);
    expect(source).toContain("ENABLE_AFTER_APPROVAL_BUDGET_MS");
    expect(source).toContain("enable after Ring approval");
    expect(source).toContain("opts.onError?.(error)");
    expect(source).toContain("function reportApprovalError");
    expect(source).not.toContain("if (!isMountedRef.current) return;\n          if (isAuthFlowExpiredError");
  });
});
