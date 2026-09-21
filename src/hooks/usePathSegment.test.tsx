/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePathSegment } from "@/hooks/usePathSegment";
import { resetHistoryPathForTests } from "@/lib/history-path";

vi.mock("next/navigation", () => ({
  usePathname: () => (typeof window === "undefined" ? "/contacts" : window.location.pathname),
}));

function Probe() {
  const id = usePathSegment("contacts");
  return <div data-testid="segment">{id ?? "none"}</div>;
}

let host: HTMLDivElement;
let root: Root;

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

describe("usePathSegment", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    window.history.replaceState({}, "", "/contacts");
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    resetHistoryPathForTests();
    window.history.replaceState({}, "", "/");
  });

  it("reads the contact id from the current path on mount", async () => {
    window.history.replaceState(
      {},
      "",
      "/contacts/o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
    );
    await render(<Probe />);
    expect(host.querySelector("[data-testid=segment]")?.textContent).toBe(
      "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
    );
  });

  it("updates after pushState without dispatching popstate", async () => {
    await render(<Probe />);
    expect(host.querySelector("[data-testid=segment]")?.textContent).toBe("none");
    await act(async () => {
      window.history.pushState(
        {},
        "",
        "/contacts/o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
      );
    });
    expect(host.querySelector("[data-testid=segment]")?.textContent).toBe(
      "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
    );
  });

  it("updates when History.prototype.pushState is invoked without popstate", async () => {
    await render(<Probe />);
    expect(host.querySelector("[data-testid=segment]")?.textContent).toBe("none");
    await act(async () => {
      History.prototype.pushState.call(
        window.history,
        {},
        "",
        "/contacts/o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
      );
    });
    expect(host.querySelector("[data-testid=segment]")?.textContent).toBe(
      "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq",
    );
  });
});
