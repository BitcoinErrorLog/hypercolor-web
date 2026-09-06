/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UxCatalog } from "@/components/ux-catalog/ux-catalog";
import { UX_CATALOG_SCENES } from "@/components/ux-catalog/scenes";

let currentScene = UX_CATALOG_SCENES[0]?.id ?? "";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentScene ? `scene=${currentScene}` : ""),
  usePathname: () => "/chats",
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    back: () => undefined,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("@/services/StorageService", () => ({
  StorageService: {
    getAllContacts: vi.fn(() => Promise.resolve([])),
    getAllLinks: vi.fn(() => Promise.resolve([])),
    getContact: vi.fn(() => Promise.resolve(null)),
    getLink: vi.fn(() => Promise.resolve(null)),
    listMessageRequests: vi.fn(() => Promise.resolve([])),
    countPendingMessageRequests: vi.fn(() => Promise.resolve(0)),
    getUnprocessedLinkStreamItems: vi.fn(() => Promise.resolve([])),
    listAttachmentsForChannel: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock("@/services/TrustEngine", () => ({
  TrustEngine: {
    explain: vi.fn(() => Promise.resolve({ score: 0, reasons: [] })),
  },
}));

vi.mock("@/services/contacts/followsImportPreference", () => ({
  isFollowsImportEnabled: vi.fn(() => false),
}));

vi.mock("@/services/contacts/followsImport", () => ({
  FollowsImporter: {
    importFollows: vi.fn(() => Promise.resolve({ ok: true, skipped: true })),
  },
}));

vi.mock("@/services/contacts/usernameSearch", () => ({
  UsernameSearch: {
    search: vi.fn(() => Promise.resolve({ ok: true, kind: "name", hits: [] })),
  },
}));

vi.mock("@/services/group/GroupService", () => ({
  GroupService: {
    getChannel: vi.fn(() => Promise.resolve(null)),
    listMessages: vi.fn(() => Promise.resolve([])),
    listMembers: vi.fn(() => Promise.resolve([])),
  },
  subscribeGroupEvents: vi.fn(() => () => undefined),
}));

vi.mock("@/services/link/LinkService", () => ({
  LinkService: {
    markRead: vi.fn(() => Promise.resolve()),
    getLinkStatus: vi.fn(async () => null),
  },
}));

vi.mock("@/services/RingConnect", () => ({
  adoptHandoff: vi.fn(() => Promise.resolve(null)),
  decryptPendingHandoff: vi.fn(() => Promise.resolve({})),
  pendingChannelMatches: vi.fn(() => Promise.resolve(false)),
  publishHandoffParamsToRelay: vi.fn(() => Promise.resolve()),
  sanitizeHandoffError: (err: unknown) =>
    err instanceof Error ? err.message : "protocol error",
  validateHandoffPublicParams: vi.fn(() => null),
}));

vi.mock("@/services/KeyStore", () => ({
  KeyStore: {
    initKeyStore: vi.fn(() => Promise.resolve()),
    getAttachmentSecret: vi.fn(() => Promise.resolve(null)),
  },
}));

vi.mock("@/services/backup/BackupService", () => ({
  BackupService: {
    exportBackup: vi.fn(() => Promise.resolve({ recoveryCode: "alpha bravo charlie delta" })),
    restoreBackup: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("@/services/vibeware/collector", () => ({
  emit: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/services/vibeware/coarse", () => ({
  emitCoarseError: vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;

function stubBrowserApis() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: () => Promise.resolve() },
  });
}

describe("UX catalog production surfaces", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    stubBrowserApis();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.innerHTML = "";
  });

  for (const scene of UX_CATALOG_SCENES) {
    it(`${scene.id} renders a production surface marker`, async () => {
      currentScene = scene.id;
      await act(async () => {
        root.render(<UxCatalog />);
      });
      const marker = document.querySelector(`[data-vrt-scene="${scene.id}"]`);
      expect(marker).not.toBeNull();
      const scope = scene.surface === "sign-out" || scene.surface === "composer-menu" || scene.surface === "composer-emoji" || scene.surface === "composer-gif" || scene.surface === "profile-qr" || scene.surface === "contacts-scan"
        ? document
        : marker;
      expect(scope?.querySelector(`[data-surface="${scene.expectedSurface}"]`)).not.toBeNull();
      if (scene.id.startsWith("thread-payment-")) {
        expect(marker?.querySelector('[data-surface="payment-notice"]')).not.toBeNull();
      }
    });
  }
});
