/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ModalSheet } from "@/components/ui/sheet";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

let host: HTMLDivElement;
let root: Root;

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matches && query === REDUCED_MOTION_QUERY,
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

describe("ModalSheet", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    stubMatchMedia(false);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("puts aria-modal on a dialog and nests role=menu inside that dialog", async () => {
    await render(
      <ModalSheet open onClose={() => undefined} role="menu" layer="gate" testId="attachMenu">
        <button type="button" role="menuitem">
          Photo
        </button>
      </ModalSheet>,
    );
    const overlay = document.querySelector("[data-testid=attachMenu]");
    const dialog = overlay?.querySelector('[role="dialog"]');
    const menu = dialog?.querySelector('[role="menu"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(menu).not.toBeNull();
    expect(overlay?.className).toContain("z-60");
  });

  it("skips enter animation when the user prefers reduced motion", async () => {
    stubMatchMedia(true);
    const animate = vi.fn();
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    await render(
      <ModalSheet open onClose={() => undefined} titleId="sheet-title" testId="motionSheet">
        <h2 id="sheet-title">Title</h2>
      </ModalSheet>,
    );
    expect(animate).not.toHaveBeenCalled();
  });

  it("runs a 150ms enter animation when motion is allowed", async () => {
    stubMatchMedia(false);
    const animate = vi.fn();
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    await render(
      <ModalSheet open onClose={() => undefined} titleId="sheet-title" testId="motionSheet">
        <h2 id="sheet-title">Title</h2>
      </ModalSheet>,
    );
    expect(animate).toHaveBeenCalled();
    expect(animate.mock.calls[0]?.[1]).toMatchObject({ duration: 150 });
  });

  it("restores focus to a connected fallback when the opener unmounted", async () => {
    const fallback = document.createElement("button");
    fallback.textContent = "Sign out";
    document.body.append(fallback);
    const opener = document.createElement("button");
    opener.textContent = "Confirm";
    document.body.append(opener);
    opener.focus();

    function Harness({ open }: { open: boolean }) {
      return (
        <ModalSheet
          open={open}
          onClose={() => undefined}
          titleId="sheet-title"
          restoreFocus={() => fallback}
          testId="focusSheet"
        >
          <h2 id="sheet-title">Title</h2>
          <button type="button">Stay</button>
        </ModalSheet>
      );
    }

    await render(<Harness open />);
    opener.remove();
    await render(<Harness open={false} />);
    expect(document.activeElement).toBe(fallback);
    fallback.remove();
  });

  it("does not restore focus onto body when the captured opener is body", async () => {
    const fallback = document.createElement("button");
    fallback.textContent = "Sign out";
    document.body.append(fallback);
    document.body.focus();

    function Harness({ open }: { open: boolean }) {
      return (
        <ModalSheet
          open={open}
          onClose={() => undefined}
          titleId="sheet-title"
          restoreFocus={() => fallback}
          testId="focusSheet"
        >
          <h2 id="sheet-title">Title</h2>
          <button type="button">Stay</button>
        </ModalSheet>
      );
    }

    await render(<Harness open />);
    await render(<Harness open={false} />);
    expect(document.activeElement).toBe(fallback);
    fallback.remove();
  });

  it("marks background inert while a gate is open and releases it on close", async () => {
    const main = document.createElement("main");
    main.id = "main-content";
    document.body.append(main);

    function Harness({ open }: { open: boolean }) {
      return (
        <ModalSheet
          open={open}
          onClose={() => undefined}
          layer="gate"
          titleId="gate-title"
          testId="backupLeaveDialog"
        >
          <h2 id="gate-title">Leave?</h2>
        </ModalSheet>
      );
    }

    await render(<Harness open />);
    expect(main.inert).toBe(true);
    await render(<Harness open={false} />);
    expect(main.inert).toBe(false);
    main.remove();
  });

  it("applies the same inert treatment when the gate is the only overlay", async () => {
    const main = document.createElement("main");
    main.id = "main-content";
    document.body.append(main);
    await render(
      <ModalSheet
        open
        onClose={() => undefined}
        layer="gate"
        titleId="parked-title"
        testId="parkedGate"
      >
        <h2 id="parked-title">Leave?</h2>
      </ModalSheet>,
    );
    expect(main.inert).toBe(true);
    expect(document.querySelector('[data-sheet-layer="gate"]')).not.toBeNull();
    main.remove();
  });

  it("refuses a sheet layer while a gate overlay is mounted", async () => {
    await render(
      <ModalSheet
        open
        onClose={() => undefined}
        layer="gate"
        titleId="gate-title"
        testId="backupLeaveDialog"
      >
        <h2 id="gate-title">Leave?</h2>
      </ModalSheet>,
    );
    expect(document.querySelector('[data-sheet-layer="gate"]')).not.toBeNull();
    await render(
      <>
        <ModalSheet
          open
          onClose={() => undefined}
          layer="gate"
          titleId="gate-title"
          testId="backupLeaveDialog"
        >
          <h2 id="gate-title">Leave?</h2>
        </ModalSheet>
        <ModalSheet
          open
          onClose={() => undefined}
          layer="sheet"
          titleId="sheet-title"
          testId="signOutDialog"
        >
          <h2 id="sheet-title">Sign out?</h2>
        </ModalSheet>
      </>,
    );
    expect(document.querySelector("[data-testid=backupLeaveDialog]")).not.toBeNull();
    expect(document.querySelector("[data-testid=signOutDialog]")).toBeNull();
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
  });
});
