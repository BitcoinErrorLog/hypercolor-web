import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { clearEnableCompleted, isEnableCompleted, markEnableCompleted } from "@/lib/enable-done";
import { readInitialSessionUiStatus, useSessionStatusStore } from "./sessionStatusStore";

function StoreKindProbe() {
  const status = useSessionStatusStore((s) => s.status);
  return createElement("span", { "data-testid": "kind" }, status.kind);
}

describe("sessionStatusStore", () => {
  beforeEach(() => {
    clearEnableCompleted();
    useSessionStatusStore.setState({ status: { kind: "unknown" } });
  });

  it("maps a missing session without identity to no-identity", () => {
    useSessionStatusStore.getState().setFromRestore({ status: "needs-enable" });
    expect(useSessionStatusStore.getState().status).toEqual({ kind: "no-identity" });
  });

  it("maps a missing session with a Welcome identity to needs-enable", () => {
    useSessionStatusStore
      .getState()
      .setFromRestore({ status: "needs-enable" }, undefined, { hasIdentity: true });
    expect(useSessionStatusStore.getState().status).toEqual({ kind: "needs-enable" });
  });

  it("maps a restored live session plus receiver to enabled", () => {
    useSessionStatusStore
      .getState()
      .setFromRestore({ status: "live", pubky: "abc" }, "enabled");
    expect(useSessionStatusStore.getState().status).toEqual({
      kind: "enabled",
      pubky: "abc",
    });
  });

  it("maps restore failure to session-offline", () => {
    useSessionStatusStore
      .getState()
      .setFromRestore({ status: "session-offline", pubky: "abc" });
    expect(useSessionStatusStore.getState().status).toEqual({
      kind: "session-offline",
      pubky: "abc",
    });
  });

  it("resets to no-identity after sign-out", () => {
    useSessionStatusStore.getState().setEnabled("abc");
    useSessionStatusStore.getState().reset();
    expect(useSessionStatusStore.getState().status).toEqual({ kind: "no-identity" });
    expect(isEnableCompleted()).toBe(false);
  });

  it("does not let a stale bootstrap clobber enabled back to needs-enable", () => {
    useSessionStatusStore.getState().setEnabled("abc");
    useSessionStatusStore
      .getState()
      .setFromRestore({ status: "needs-enable" }, "needs-enable", { hasIdentity: true });
    expect(useSessionStatusStore.getState().status).toEqual({
      kind: "enabled",
      pubky: "abc",
    });
    expect(isEnableCompleted()).toBe(true);
  });

  it("heals a fresh store instance from the durable Enable flag", () => {
    useSessionStatusStore.getState().setEnabled("abc");
    useSessionStatusStore.setState({ status: { kind: "unknown" } });
    useSessionStatusStore
      .getState()
      .setFromRestore({ status: "live", pubky: "abc" }, "needs-enable");
    expect(useSessionStatusStore.getState().status).toEqual({
      kind: "enabled",
      pubky: "abc",
    });
  });

  it("does not let a stale bootstrap clobber needs-enable back to no-identity", () => {
    useSessionStatusStore.getState().setNeedsEnable();
    useSessionStatusStore.getState().setFromRestore({ status: "needs-enable" });
    expect(useSessionStatusStore.getState().status).toEqual({ kind: "needs-enable" });
  });

  it("still allows session-offline after enabled", () => {
    useSessionStatusStore.getState().setEnabled("abc");
    useSessionStatusStore
      .getState()
      .setFromRestore({ status: "session-offline", pubky: "abc" });
    expect(useSessionStatusStore.getState().status).toEqual({
      kind: "session-offline",
      pubky: "abc",
    });
  });

  it("keeps the same store instance across a simulated Fast Refresh re-import", async () => {
    useSessionStatusStore.getState().setEnabled("pinned");
    const first = useSessionStatusStore;
    const reimported = await import("./sessionStatusStore");
    expect(reimported.useSessionStatusStore).toBe(first);
    expect(reimported.useSessionStatusStore.getState().status).toEqual({
      kind: "enabled",
      pubky: "pinned",
    });
  });

  it("reads enabled from the durable flag before the first store subscriber mounts", () => {
    expect(readInitialSessionUiStatus()).toEqual({ kind: "unknown" });
    markEnableCompleted("pk:boot");
    expect(readInitialSessionUiStatus()).toEqual({
      kind: "enabled",
      pubky: "pk:boot",
    });
  });

  it("first render after setEnabled is enabled without waiting for an effect", () => {
    useSessionStatusStore.getState().setEnabled("pk:paint");
    expect(useSessionStatusStore.getInitialState().status).toEqual({
      kind: "enabled",
      pubky: "pk:paint",
    });
    const html = renderToString(createElement(StoreKindProbe));
    expect(html).toContain("enabled");
  });
});
