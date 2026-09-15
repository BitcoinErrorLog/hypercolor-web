/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSignOut } from "@/hooks/useSignOut";
import { getBackupGate, setBackupGate } from "@/lib/backup-gate";
import {
  clearListDetailFocus,
  peekThreadOrigin,
  rememberListRow,
  rememberThreadOrigin,
  takeListRow,
} from "@/lib/list-detail-focus";
import { COHORT_STORAGE_KEY, clearCohortKey } from "@/services/vibeware/cohort";
import { useInboxStore } from "@/stores/inboxStore";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const clearSession = vi.fn(async () => undefined);
const requestPush = vi.fn(() => true);

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    back: () => undefined,
  }),
}));

vi.mock("@/services/link/LinkService", () => ({
  LinkService: {
    clearSession: () => clearSession(),
  },
}));

vi.mock("@/hooks/useBlockingGate", () => ({
  useBlockingGate: () => ({
    requestPush,
    requestRun: (run: () => void) => {
      run();
      return true;
    },
    requestReplace: () => true,
    requestBack: () => true,
  }),
}));

function Probe() {
  const { signOut, busy } = useSignOut();
  return (
    <button type="button" data-testid="signOutProbe" disabled={busy} onClick={() => signOut()}>
      out
    </button>
  );
}

let host: HTMLDivElement;
let root: Root;

async function render(ui: ReactElement) {
  await act(async () => {
    root.render(ui);
  });
}

describe("useSignOut local cleanup", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    clearSession.mockClear();
    requestPush.mockClear();
    sessionStorage.clear();
    localStorage.clear();
    clearListDetailFocus();
    clearCohortKey();
    setBackupGate({ recoveryCode: null, confirmedSaved: false });
    useInboxStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => {
      root.unmount();
    });
    host.remove();
    sessionStorage.clear();
    localStorage.clear();
    clearListDetailFocus();
    clearCohortKey();
    setBackupGate({ recoveryCode: null, confirmedSaved: false });
  });

  it("clears list/thread origins, the cohort key, and the backup gate", async () => {
    rememberThreadOrigin({ kind: "contact", pubky: OWNER });
    rememberListRow("contacts", "contact-row-1");
    localStorage.setItem(COHORT_STORAGE_KEY, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    setBackupGate({ recoveryCode: "abcd1234wxyz", confirmedSaved: true });
    await render(<Probe />);
    await act(async () => {
      host.querySelector("[data-testid=signOutProbe]")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(clearSession).toHaveBeenCalled();
    });
    expect(peekThreadOrigin()).toBeNull();
    expect(takeListRow("contacts")).toBeNull();
    expect(sessionStorage.getItem("hypercolor.thread-origin")).toBeNull();
    expect(sessionStorage.getItem("hypercolor.list-detail-origin")).toBeNull();
    expect(localStorage.getItem(COHORT_STORAGE_KEY)).toBeNull();
    expect(getBackupGate().recoveryCode).toBeNull();
    expect(requestPush).toHaveBeenCalledWith("/");
  });

  it("still resets stores and navigates when a storage clear throws", async () => {
    rememberThreadOrigin({ kind: "contact", pubky: OWNER });
    localStorage.setItem(COHORT_STORAGE_KEY, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    setBackupGate({ recoveryCode: "zzzz9999yyyy", confirmedSaved: true });
    useInboxStore.setState({
      rows: [{ id: "row-1" } as never],
      pendingRequests: 2,
      loading: false,
      error: null,
    });

    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    await render(<Probe />);
    await act(async () => {
      host.querySelector("[data-testid=signOutProbe]")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(clearSession).toHaveBeenCalled();
    });
    expect(useInboxStore.getState().rows).toEqual([]);
    expect(useInboxStore.getState().pendingRequests).toBe(0);
    expect(requestPush).toHaveBeenCalledWith("/");
  });
});
