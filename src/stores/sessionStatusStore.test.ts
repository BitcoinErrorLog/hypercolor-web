import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStatusStore } from "./sessionStatusStore";

describe("sessionStatusStore", () => {
  beforeEach(() => {
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
});
