/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ContactsPage } from "./contacts-page";
import { SCAN_DENIED_MESSAGE, SCAN_UNSUPPORTED_MESSAGE } from "./contact-qr-scanner";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const PEER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/contacts",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
}));

vi.mock("@/hooks/usePathSegment", () => ({
  usePathSegment: () => null,
}));

vi.mock("@/hooks/useBlockingGate", () => ({
  useGuardedRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
}));

vi.mock("@/components/follows-import-panel", () => ({
  FollowsImportPanel: () => null,
}));

vi.mock("@/components/contact-detail", () => ({
  ContactDetail: () => null,
}));

let host: HTMLDivElement;
let root: Root;

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

const emptyFixture = {
  ownerPubky: OWNER,
  selected: null,
  contacts: [],
  draft: "",
  busy: false,
  searchBusy: false,
  error: null,
  hits: null,
};

describe("ContactsPage pubky payload input", () => {
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

  it("treats a pasted pubky:// URI as an add-contact identity", async () => {
    await render(<ContactsPage fixture={{ ...emptyFixture, draft: `pubky://${PEER}` }} />);
    const add = document.querySelector('[data-testid="contactSearchAdd"]');
    expect(add?.textContent).toContain("Add contact");
    expect(document.querySelector('[data-testid="contactSearchLookup"]')).toBeNull();
  });

  it("treats a pubky.app profile URL as an add-contact identity", async () => {
    await render(
      <ContactsPage fixture={{ ...emptyFixture, draft: `https://pubky.app/profile/${PEER}` }} />,
    );
    expect(document.querySelector('[data-testid="contactSearchAdd"]')?.textContent).toContain(
      "Add contact",
    );
  });

  it("shows unsupported scanner copy", async () => {
    await render(<ContactsPage fixture={{ ...emptyFixture, scanner: "unsupported" }} />);
    expect(document.querySelector('[data-testid="contactScanner"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="contactScanError"]')?.textContent).toBe(
      SCAN_UNSUPPORTED_MESSAGE,
    );
  });

  it("shows camera-denied scanner copy", async () => {
    await render(<ContactsPage fixture={{ ...emptyFixture, scanner: "denied" }} />);
    expect(document.querySelector('[data-testid="contactScanError"]')?.textContent).toBe(
      SCAN_DENIED_MESSAGE,
    );
  });
});
