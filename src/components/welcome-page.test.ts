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
  it("hides Connect while a live or expired authorization is presenting", () => {
    expect(source).toContain("welcomeReloadPage");
    expect(source).toContain("Reload page");
    expect(source).toContain('data-testid="welcomeCancel"');
    expect(source).toContain("onCancelWaiting");
    expect(source).not.toContain("paykit-connect");
    expect(resolveWelcomePhase({ ...base, linkLive: true })).toBe("waiting");
    expect(resolveWelcomePhase({ ...base, isExpired: true })).toBe("expired");
  });

  it("cancels waiting without writing the keystore", () => {
    expect(actions).toContain("onCancelWaiting");
    expect(actions).toContain("auth.cancel()");
    expect(actions).toContain("adoptOnApproval: false");
  });

  it("removes the QR while finishing sign-in", () => {
    expect(resolveWelcomePhase({ ...base, linkLive: true, finishing: true })).toBe(
      "finishing",
    );
    expect(resolveWelcomePhase({ ...base, finishing: true })).toBe("finishing");
    expect(source).toContain("Finishing sign-in…");
    expect(source).toContain('data-testid="welcomeFinishing"');
    expect(source).toContain('showQr = phase === "waiting"');
    expect(source).toContain("Show QR again");
    expect(actions).toContain("setFinishing(true)");
    expect(actions).toContain("adoptApprovedSession");
    expect(actions).toContain("ensureWriter");
    expect(actions).not.toContain("finishSingleApproval");
    expect(actions).not.toContain("finishLegacyChainedGrant");
    expect(actions).not.toContain('router.push("/enable")');
    expect(actions).toContain('router.push("/chats")');
  });

  it("surfaces a full-width failed state with Try again", () => {
    expect(resolveWelcomePhase({ ...base, error: "network error" })).toBe("failed");
    expect(source).toContain('data-testid="welcomeFailed"');
    expect(source).toContain('retryLabel="Try again"');
    expect(actions).toContain("auth.fetchUrl()");
  });

  it("reaches ready when a fresh pubky is waiting for confirm", () => {
    expect(
      resolveWelcomePhase({
        ...base,
        pendingPubky: "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
      }),
    ).toBe("ready");
    expect(source).toContain("Continue as");
  });
});
