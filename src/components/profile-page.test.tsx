/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProfilePage } from "./profile-page";
import { canonicalPubkyUri } from "@/lib/pubkyPayload";
import { useAuthStore } from "@/stores/authStore";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";

const PUBKY = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/useSignOut", () => ({
  useSignOut: () => ({ signOut: () => true, busy: false }),
}));

vi.mock("@/components/enable-messaging-cta", () => ({
  EnableMessagingCta: () => <div data-testid="profileEnableMessaging" />,
}));

let host: HTMLDivElement;
let root: Root;
const writeText = vi.fn(() => Promise.resolve());

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

describe("ProfilePage QR sheet", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    writeText.mockClear();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: () => ({
        matches: true,
        media: "",
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    useAuthStore.getState().setAuthenticated(PUBKY, "homeserver.staging.pubky.app");
    useAuthStore.getState().setProfile({ pubky: PUBKY, displayName: "Ada", updatedAt: 1 });
    useSessionStatusStore.getState().setEnabled(PUBKY);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    useAuthStore.getState().clearSession();
  });

  it("renders the canonical pubky URI and copies it", async () => {
    await render(<ProfilePage fixture={{ qrOpen: true }} />);
    const sheet = document.querySelector('[data-testid="profileQrSheet"]');
    expect(sheet).not.toBeNull();
    const expected = canonicalPubkyUri(PUBKY);
    expect(document.querySelector('[data-testid="profileQrPayload"]')?.textContent).toBe(expected);
    expect(document.querySelector('[data-testid="profileQrImage"] img')?.getAttribute("alt")).toBe(
      "Pubky QR code",
    );
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="profileQrCopy"]')?.click();
    });
    expect(writeText).toHaveBeenCalledWith(expected);
  });
});
