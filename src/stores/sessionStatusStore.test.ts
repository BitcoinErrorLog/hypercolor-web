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

  it("keeps enabled when a load-time snapshot lands after the Enable flow committed", () => {
    useSessionStatusStore.getState().setEnabled("abc");
    useSessionStatusStore
      .getState()
      .setFromRestore({ status: "needs-enable" }, undefined, { hasIdentity: true });
    expect(useSessionStatusStore.getState().status).toEqual({
      kind: "enabled",
      pubky: "abc",
    });
  });

  it("keeps enabled when a stale snapshot reports the session offline", () => {
    useSessionStatusStore.getState().setEnabled("abc");
    useSessionStatusStore
      .getState()
      .setFromRestore({ status: "session-offline", pubky: "abc" });
    expect(useSessionStatusStore.getState().status).toEqual({
      kind: "enabled",
      pubky: "abc",
    });
  });

  it("carries the known pubky into session-offline when restore omits it", () => {
    useSessionStatusStore.getState().setFromRestore({ status: "live", pubky: "abc" });
    useSessionStatusStore.getState().setFromRestore({ status: "session-offline" });
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
});
