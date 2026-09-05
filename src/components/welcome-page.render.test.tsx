/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WelcomePage } from "./welcome-page";

let host: HTMLDivElement;
let root: Root;

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

function getByTestId(id: string): Element {
  const el = host.querySelector(`[data-testid="${id}"]`);
  if (!el) throw new Error(`Unable to find an element with data-testid="${id}"`);
  return el;
}

function queryByTestId(id: string): Element | null {
  return host.querySelector(`[data-testid="${id}"]`);
}

const qr = <div data-testid="welcomeQr">QR</div>;
const noop = () => undefined;

function pageProps(overrides: Partial<Parameters<typeof WelcomePage>[0]> = {}) {
  return {
    appName: "Hypercolor",
    isAuthenticated: false,
    pubky: null,
    isLoading: false,
    isExpired: false,
    error: null,
    pendingPubky: null,
    adopting: false,
    authPanel: qr,
    linkLive: true,
    finishing: false,
    ch: "8eOwP5zDIW4PwXitMsHu3RdUDCF60o3DTwI-firPVT8",
    onGenerateLink: noop,
    onConfirmAdoption: noop,
    onCancelAdoption: noop,
    onCancelWaiting: noop,
    onShowQrAgain: noop,
    ...overrides,
  };
}

describe("WelcomePage QR visibility", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("unmounts the QR when finishing, and keeps it unmounted after finishing→failed", async () => {
    await render(<WelcomePage {...pageProps()} />);
    expect(getByTestId("welcomeQr")).toBeTruthy();
    expect(getByTestId("welcomeVerificationCode").textContent).toBe("8eO-wP5");

    await render(<WelcomePage {...pageProps({ finishing: true, linkLive: true })} />);
    expect(queryByTestId("welcomeQr")).toBeNull();
    expect(getByTestId("welcomeFinishing")).toBeTruthy();
    expect(getByTestId("welcomeShowQrAgain")).toBeTruthy();
    expect(getByTestId("welcomeCancel")).toBeTruthy();

    await render(
      <WelcomePage
        {...pageProps({
          finishing: false,
          linkLive: false,
          error: "network error",
        })}
      />,
    );
    expect(queryByTestId("welcomeQr")).toBeNull();
    expect(getByTestId("welcomeFailed")).toBeTruthy();
    expect(getByTestId("welcomeShowQrAgain")).toBeTruthy();
    expect(host.textContent).toContain("Try again");
  });

  it("offers Show QR again and Reload page when the link is expired", async () => {
    await render(<WelcomePage {...pageProps({ isExpired: true, linkLive: false, authPanel: null })} />);
    expect(getByTestId("welcomeShowQrAgain")).toBeTruthy();
    expect(getByTestId("welcomeReloadPage").textContent).toContain("Reload page");
    expect(getByTestId("welcomeGenerate")).toBeTruthy();
  });
});
