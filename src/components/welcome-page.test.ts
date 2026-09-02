import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "welcome-page.tsx"),
  "utf8",
);
const actions = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../services/onboarding/welcomeActions.tsx",
  ),
  "utf8",
);

describe("welcome awaiting states", () => {
  it("hides Connect while a live or expired link is presenting", () => {
    expect(source).toContain("presentingAuth = linkLive || isExpired");
    expect(source).toContain("presentingAuth ? null");
    expect(source).toContain('data-testid="welcomeGenerate"');
    expect(source).toContain('data-testid="welcomeCancel"');
    expect(source).toContain("onCancelWaiting");
  });

  it("cancels waiting by aborting the paykit-connect poll", () => {
    expect(actions).toContain("onCancelWaiting");
    expect(actions).toContain("connect.cancel()");
  });
});
