/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsPage } from "@/components/settings-page";
import {
  clearBackupGate,
  confirmPendingBackupLeave,
  readLastBackupAt,
  rememberBackupCreated,
  requestGuardedNavigation,
} from "@/lib/backup-gate";

const exportBackup = vi.fn(async () => ({
  recoveryCode: "abcd1234wxyz",
  path: "/pub/hypercolor.app/v1/backup/latest",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    back: () => undefined,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/services/backup/BackupService", () => ({
  BackupService: {
    exportBackup: () => exportBackup(),
    restoreBackup: vi.fn(),
  },
}));

vi.mock("@/services/link/LinkService", () => ({
  LinkService: { clearSession: vi.fn(async () => undefined) },
}));

vi.mock("@/services/StorageService", () => ({
  StorageService: {
    ensureChatDevicePrefs: vi.fn(async () => ({
      ownerPubky: "x",
      receiptsEnabled: true,
      typingEnabled: true,
      upgradeAt: 1,
      updatedAt: 1,
    })),
    setReceiptsEnabled: vi.fn(async () => undefined),
  },
}));

vi.mock("@/services/vibeware/collector", () => ({
  emit: vi.fn(async () => undefined),
}));

vi.mock("@/services/vibeware/coarse", () => ({
  emitCoarseError: vi.fn(),
}));

vi.mock("@/services/vibeware/leave", () => ({
  useLeaveOnce: () => undefined,
}));

let host: HTMLDivElement;
let root: Root;

function stubMatchMedia() {
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
}

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

describe("settings backup timestamp", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    stubMatchMedia();
    localStorage.clear();
    clearBackupGate();
    exportBackup.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    localStorage.clear();
    clearBackupGate();
  });

  it("does not record lastBackupAt on export success", async () => {
    await render(<SettingsPage />);
    await act(async () => {
      host.querySelector("[data-testid=settingsBackup]")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(exportBackup).toHaveBeenCalled();
    });
    expect(host.querySelector("[data-testid=recoveryCode]")?.textContent).toMatch(/abcd/);
    expect(readLastBackupAt()).toBeNull();
  });

  it("records lastBackupAt only after Done", async () => {
    const prior = 1_700_000_000_000;
    rememberBackupCreated(prior);
    await render(<SettingsPage />);
    await act(async () => {
      host.querySelector("[data-testid=settingsBackup]")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=recoveryCode]")).toBeTruthy();
    });
    expect(readLastBackupAt()).toBe(prior);
    const checkbox = host.querySelector("[data-testid=recoveryCodeSaved]");
    expect(checkbox).toBeTruthy();
    await act(async () => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(
        (host.querySelector("[data-testid=recoveryCodeDone]") as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    const beforeDone = Date.now();
    await act(async () => {
      host.querySelector("[data-testid=recoveryCodeDone]")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const recorded = readLastBackupAt();
    expect(recorded).not.toBe(prior);
    expect(recorded).toBeGreaterThanOrEqual(beforeDone);
  });

  it("Leave anyway after export leaves a previous timestamp untouched", async () => {
    const prior = 1_650_000_000_000;
    rememberBackupCreated(prior);
    await render(<SettingsPage />);
    await act(async () => {
      host.querySelector("[data-testid=settingsBackup]")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(host.querySelector("[data-testid=recoveryCode]")).toBeTruthy();
    });
    expect(readLastBackupAt()).toBe(prior);
    requestGuardedNavigation(() => undefined);
    confirmPendingBackupLeave();
    expect(readLastBackupAt()).toBe(prior);
  });
});
