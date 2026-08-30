import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resume = vi.fn();
const signOutSession = vi.fn();
const removeReceiverMarker = vi.fn();

vi.mock("./PaykitLinkWeb", () => ({
  PaykitLinkWeb: {
    resumeSessionFromCookie: (...args: unknown[]) => resume(...args),
    signOutSession: (...args: unknown[]) => signOutSession(...args),
    removeReceiverMarker: (...args: unknown[]) => removeReceiverMarker(...args),
  },
}));

vi.mock("@/services/StorageService", () => ({
  StorageService: {
    retryPendingCleanup: vi.fn(async () => undefined),
    getLinkReceiver: vi.fn(async () => null),
    clearAccountData: vi.fn(async () => undefined),
  },
}));

vi.mock("@/services/KeyStore", () => ({
  KeyStore: {
    setPubky: vi.fn(async () => undefined),
    getPubky: vi.fn(async () => null),
    clear: vi.fn(async () => undefined),
  },
}));

import {
  classifyResumeError,
  persistSessionMetadata,
  readSessionMetadata,
  resetSessionStateForTests,
  restoreSessionOnLoad,
  wipeSessionMetadata,
} from "./session";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const OTHER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

function namedError(name: string, message = name): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function fakeHandle(pubky: string, exported: string) {
  return {
    pubky: () => pubky,
    exportSession: () => exported,
    free: vi.fn(),
  };
}

function exportWithCaps(...specs: string[]): string {
  return btoa(`meta${specs.join(",")}`);
}

describe("session restore classification", () => {
  beforeEach(async () => {
    resetSessionStateForTests();
    resume.mockReset();
    signOutSession.mockReset();
    removeReceiverMarker.mockReset();
    await persistSessionMetadata({
      pubky: OWNER,
      exported: exportWithCaps("/pub/paykit/:rw"),
    });
  });

  afterEach(async () => {
    resetSessionStateForTests();
    await wipeSessionMetadata();
  });

  it("classifies typed resume names as auth-revoked and transport as offline", () => {
    expect(classifyResumeError(namedError("SessionResumeUnauthorized"))).toBe(
      "auth-revoked",
    );
    expect(classifyResumeError(namedError("SessionResumePubkyMismatch"))).toBe(
      "auth-revoked",
    );
    expect(classifyResumeError(namedError("SessionResumeScopeMissing"))).toBe(
      "auth-revoked",
    );
    expect(classifyResumeError(namedError("TypeError", "fetch failed"))).toBe(
      "session-offline",
    );
  });

  it("restores a live session and overwrites exported with the homeserver grant", async () => {
    const fresh = exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw");
    const handle = fakeHandle(OWNER, fresh);
    resume.mockResolvedValue(handle);

    const result = await restoreSessionOnLoad();
    expect(result.status).toBe("live");
    if (result.status === "live") {
      expect(result.pubky).toBe(OWNER);
      expect(result.handle).toBe(handle);
    }
    expect(await readSessionMetadata()).toEqual({ pubky: OWNER, exported: fresh });
  });

  it("wipes metadata on SessionResumeUnauthorized", async () => {
    resume.mockRejectedValue(namedError("SessionResumeUnauthorized"));
    const result = await restoreSessionOnLoad();
    expect(result).toEqual({ status: "needs-enable" });
    expect(await readSessionMetadata()).toBeNull();
  });

  it("wipes metadata on SessionResumePubkyMismatch", async () => {
    resume.mockRejectedValue(namedError("SessionResumePubkyMismatch"));
    await expect(restoreSessionOnLoad()).resolves.toEqual({
      status: "needs-enable",
    });
    expect(await readSessionMetadata()).toBeNull();
  });

  it("wipes metadata on SessionResumeScopeMissing", async () => {
    resume.mockRejectedValue(namedError("SessionResumeScopeMissing"));
    await expect(restoreSessionOnLoad()).resolves.toEqual({
      status: "needs-enable",
    });
    expect(await readSessionMetadata()).toBeNull();
  });

  it("treats a paykit-only grant as needs-enable", async () => {
    const handle = fakeHandle(OWNER, exportWithCaps("/pub/paykit/:rw"));
    resume.mockResolvedValue(handle);
    signOutSession.mockResolvedValue(undefined);
    const result = await restoreSessionOnLoad();
    expect(result).toEqual({ status: "needs-enable" });
    expect(await readSessionMetadata()).toBeNull();
    expect(signOutSession).toHaveBeenCalledWith(handle);
  });

  it("keeps metadata on an untyped transport failure", async () => {
    resume.mockRejectedValue(namedError("Error", "cookie resume failed: network"));
    const result = await restoreSessionOnLoad();
    expect(result).toEqual({ status: "session-offline", pubky: OWNER });
    expect(await readSessionMetadata()).toEqual({
      pubky: OWNER,
      exported: exportWithCaps("/pub/paykit/:rw"),
    });
  });

  it("wipes a stored blob whose resumed pubky does not match", async () => {
    const handle = fakeHandle(
      OTHER,
      exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
    );
    resume.mockResolvedValue(handle);
    const result = await restoreSessionOnLoad();
    expect(result).toEqual({ status: "needs-enable" });
    expect(await readSessionMetadata()).toBeNull();
  });

  it("shares one in-flight restore", async () => {
    let resolveResume: (value: unknown) => void = () => {};
    resume.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResume = resolve;
        }),
    );
    const first = restoreSessionOnLoad();
    const second = restoreSessionOnLoad();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    resolveResume(
      fakeHandle(
        OWNER,
        exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
      ),
    );
    await expect(first).resolves.toMatchObject({ status: "live", pubky: OWNER });
    await expect(second).resolves.toMatchObject({ status: "live", pubky: OWNER });
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
