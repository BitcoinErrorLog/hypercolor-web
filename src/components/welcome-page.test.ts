import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveWelcomePhase } from "./welcome-phase";

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

const base = {
  isExpired: false,
  error: null as string | null,
  pendingPubky: null as string | null,
  linkLive: false,
  finishing: false,
};

describe("welcome awaiting states", () => {
  it("hides Connect while a live or expired link is presenting", () => {
    expect(source).toContain('data-testid="welcomeGenerate"');
    expect(source).toContain('data-testid="welcomeCancel"');
    expect(source).toContain("onCancelWaiting");
    expect(resolveWelcomePhase({ ...base, linkLive: true })).toBe("waiting");
    expect(resolveWelcomePhase({ ...base, isExpired: true })).toBe("expired");
  });

  it("cancels waiting by aborting the paykit-connect poll", () => {
    expect(actions).toContain("onCancelWaiting");
    expect(actions).toContain("connect.cancel()");
  });

  it("removes the QR when relay params arrive and shows finishing", () => {
    expect(resolveWelcomePhase({ ...base, linkLive: true, finishing: true })).toBe(
      "finishing",
    );
    expect(resolveWelcomePhase({ ...base, finishing: true })).toBe("finishing");
    expect(source).toContain("Finishing sign-in…");
    expect(source).toContain('data-testid="welcomeFinishing"');
    expect(source).toContain("showQr = phase === \"waiting\"");
    expect(source).toContain("Show QR again");
    expect(actions).toContain("setFinishing(true)");
    expect(actions).toContain('phase === "waiting" ? buildAuthPanel');
    expect(actions).toContain("connect.showQrAgain()");
  });

  it("surfaces a full-width failed state with Try again", () => {
    expect(resolveWelcomePhase({ ...base, error: "network error" })).toBe("failed");
    expect(source).toContain('data-testid="welcomeFailed"');
    expect(source).toContain('retryLabel="Try again"');
    expect(actions).toContain("sanitizeHandoffError");
    expect(actions).toContain("start({ replace: true })");
  });

  it("reaches ready after a successful decrypt", () => {
    expect(
      resolveWelcomePhase({
        ...base,
        pendingPubky: "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
      }),
    ).toBe("ready");
  });
});
