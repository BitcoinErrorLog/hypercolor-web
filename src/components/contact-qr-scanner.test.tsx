/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ContactQrScanner,
  SCAN_DENIED_MESSAGE,
  SCAN_UNSUPPORTED_MESSAGE,
} from "./contact-qr-scanner";

let host: HTMLDivElement;
let root: Root;

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

describe("ContactQrScanner", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
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
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("explains when BarcodeDetector is missing", async () => {
    await render(
      <ContactQrScanner open onClose={() => undefined} onDecoded={() => undefined} />,
    );
    expect(document.querySelector('[data-testid="contactScanError"]')?.textContent).toBe(
      SCAN_UNSUPPORTED_MESSAGE,
    );
  });

  it("explains when getUserMedia is denied", async () => {
    class FakeDetector {
      detect() {
        return Promise.resolve([]);
      }
    }
    Object.defineProperty(globalThis, "BarcodeDetector", {
      configurable: true,
      value: FakeDetector,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
      },
    });
    await render(
      <ContactQrScanner open onClose={() => undefined} onDecoded={() => undefined} />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('[data-testid="contactScanError"]')?.textContent).toBe(
      SCAN_DENIED_MESSAGE,
    );
    Reflect.deleteProperty(globalThis, "BarcodeDetector");
  });
});
