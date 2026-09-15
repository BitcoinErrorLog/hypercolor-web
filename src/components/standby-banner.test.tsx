/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StandbyBanner } from "@/components/standby-banner";
import {
  REENABLE_BANNER_TITLE,
  STANDBY_BANNER_TITLE,
} from "@/services/link/provisionReceiver";
import { useReceiverRoleStore } from "@/services/link/receiverRoleStore";
import { LinkService } from "@/services/link/LinkService";

vi.mock("@/services/link/LinkService", () => ({
  LinkService: {
    takeOverReceiver: vi.fn(),
  },
}));

let host: HTMLDivElement;
let root: Root;

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

describe("StandbyBanner", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    useReceiverRoleStore.getState().reset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("snoozes the standby banner for the session", async () => {
    useReceiverRoleStore.getState().setRole("standby");
    await render(<StandbyBanner />);
    expect(host.querySelector('[data-testid="standbyBanner"]')?.textContent).toContain(
      STANDBY_BANNER_TITLE,
    );
    await act(async () => {
      host.querySelector('[data-testid="standbyKeepExisting"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(host.querySelector('[data-testid="standbyBanner"]')).toBeNull();
    expect(useReceiverRoleStore.getState().snoozedStandby).toBe(true);
    await render(<StandbyBanner />);
    expect(host.querySelector('[data-testid="standbyBanner"]')).toBeNull();
  });

  it("shows a re-enable prompt when the active marker is gone", async () => {
    useReceiverRoleStore.getState().setRole("active", null, { needsReenable: true });
    await render(<StandbyBanner />);
    expect(host.querySelector('[data-testid="reenableBanner"]')?.textContent).toContain(
      REENABLE_BANNER_TITLE,
    );
    await act(async () => {
      host.querySelector('[data-testid="standbyKeepExisting"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(host.querySelector('[data-testid="reenableBanner"]')).toBeNull();
    expect(useReceiverRoleStore.getState().snoozedReenable).toBe(true);
  });

  it("double-confirming takeover fires one takeOverReceiver", async () => {
    const takeOver = vi.mocked(LinkService.takeOverReceiver);
    let release: () => void = () => undefined;
    takeOver.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              pubky: "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
              receiverPath: "hypercolor/wallet",
              noisePublicKey: "pk",
              receiverRole: "active",
            });
        }),
    );
    useReceiverRoleStore.getState().setRole("standby");
    await render(<StandbyBanner />);
    await act(async () => {
      host.querySelector('[data-testid="standbyTakeover"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const confirm = document.querySelector('[data-testid="standbyTakeoverConfirm"]');
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(takeOver).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
    });
  });
});
