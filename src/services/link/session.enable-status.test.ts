import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LINK_RECEIVER_PATH } from "@/types/link";

const resume = vi.fn();
const restoreExport = vi.fn();
const getReceiver = vi.fn();
const getReceiverNoiseSecret = vi.fn();
const getPubky = vi.fn();
const setPubky = vi.fn();

vi.mock("./PaykitLinkWeb", () => ({
  PaykitLinkWeb: {
    resumeSessionFromCookie: (...args: unknown[]) => resume(...args),
    restoreSession: (...args: unknown[]) => restoreExport(...args),
    signOutSession: vi.fn(),
    removeReceiverMarker: vi.fn(),
  },
}));

vi.mock("@/services/StorageService", () => ({
  StorageService: {
    retryPendingCleanup: vi.fn(async () => undefined),
    getLinkReceiver: (...args: unknown[]) => getReceiver(...args),
    clearAccountData: vi.fn(async () => undefined),
  },
}));

const sessionExportBox = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("@/services/KeyStore", () => ({
  KeyStore: {
    setPubky: (...args: unknown[]) => setPubky(...args),
    getPubky: (...args: unknown[]) => getPubky(...args),
    getReceiverNoiseSecret: (...args: unknown[]) => getReceiverNoiseSecret(...args),
    clear: vi.fn(async () => undefined),
    setSessionExport: vi.fn(async (value: string) => {
      sessionExportBox.value = value;
    }),
    getSessionExport: vi.fn(async () => sessionExportBox.value),
    deleteSessionExport: vi.fn(async () => {
      sessionExportBox.value = null;
    }),
  },
}));

import {
  getEnableStatus,
  persistReceiverPath,
  persistSessionMetadata,
  resetSessionStateForTests,
  wipeSessionMetadata,
} from "./session";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

function namedError(name: string, message = name): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function exportWithCaps(...specs: string[]): string {
  return btoa(`meta${specs.join(",")}`);
}

function fakeHandle(pubky: string, exported: string) {
  return {
    pubky: () => pubky,
    exportSession: () => exported,
    free: vi.fn(),
  };
}

describe("getEnableStatus durable evidence", () => {
  beforeEach(async () => {
    resetSessionStateForTests();
    resume.mockReset();
    restoreExport.mockReset();
    restoreExport.mockRejectedValue(namedError("Error", "export unused"));
    getReceiver.mockReset();
    getReceiver.mockResolvedValue(null);
    getReceiverNoiseSecret.mockReset();
    getReceiverNoiseSecret.mockResolvedValue(null);
    getPubky.mockReset();
    getPubky.mockResolvedValue(OWNER);
    setPubky.mockReset();
    setPubky.mockResolvedValue(undefined);
    await persistSessionMetadata({
      pubky: OWNER,
      exported: exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
      receiverPath: LINK_RECEIVER_PATH,
    });
  });

  afterEach(async () => {
    resetSessionStateForTests();
    await wipeSessionMetadata();
  });

  it("reports enabled even when journal cleanup never settles", async () => {
    const { StorageService } = await import("@/services/StorageService");
    vi.mocked(StorageService.retryPendingCleanup).mockImplementation(
      () => new Promise(() => {}),
    );
    resume.mockResolvedValue(
      fakeHandle(
        OWNER,
        exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
      ),
    );
    getReceiverNoiseSecret.mockResolvedValue(new Uint8Array(32).fill(7));
    resetSessionStateForTests();
    await expect(getEnableStatus()).resolves.toBe("enabled");
  });

  it("is enabled after a simulated reload when cookie resume and receiver keys exist", async () => {
    resume.mockResolvedValue(
      fakeHandle(
        OWNER,
        exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
      ),
    );
    getReceiverNoiseSecret.mockResolvedValue(new Uint8Array(32).fill(3));

    resetSessionStateForTests();
    await expect(getEnableStatus()).resolves.toBe("enabled");
    expect(getReceiverNoiseSecret).toHaveBeenCalledWith(LINK_RECEIVER_PATH);
  });

  it("is needs-enable after reload when the receiver secret is gone", async () => {
    resume.mockResolvedValue(
      fakeHandle(
        OWNER,
        exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
      ),
    );
    getReceiverNoiseSecret.mockResolvedValue(null);
    resetSessionStateForTests();
    await expect(getEnableStatus()).resolves.toBe("needs-enable");
  });

  it("keeps metadata when cookie looks revoked but receiver keys still exist", async () => {
    resume.mockRejectedValue(namedError("SessionResumeUnauthorized"));
    getReceiverNoiseSecret.mockResolvedValue(new Uint8Array(32).fill(6));
    resetSessionStateForTests();
    await expect(getEnableStatus()).resolves.toBe("session-offline");
    const { readSessionMetadata } = await import("./session");
    await expect(readSessionMetadata()).resolves.toMatchObject({ pubky: OWNER });
  });

  it("is session-offline when keys exist but the session cannot be restored", async () => {
    resume.mockRejectedValue(namedError("Error", "cookie resume failed: network"));
    getReceiverNoiseSecret.mockResolvedValue(new Uint8Array(32).fill(4));
    resetSessionStateForTests();
    await expect(getEnableStatus()).resolves.toBe("session-offline");
  });

  it("is needs-enable when the session is offline and there is no receiver secret", async () => {
    resume.mockRejectedValue(namedError("Error", "cookie resume failed: network"));
    getReceiverNoiseSecret.mockResolvedValue(null);
    resetSessionStateForTests();
    await expect(getEnableStatus()).resolves.toBe("needs-enable");
  });

  it("is enabled from the receiver secret when metadata predates receiver-path evidence", async () => {
    await persistSessionMetadata({
      pubky: OWNER,
      exported: exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
    });
    resume.mockResolvedValue(
      fakeHandle(
        OWNER,
        exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
      ),
    );
    getReceiverNoiseSecret.mockResolvedValue(new Uint8Array(32).fill(5));
    getReceiver.mockResolvedValue({
      ownerPubky: OWNER,
      receiverAlias: LINK_RECEIVER_PATH,
      receiverPath: LINK_RECEIVER_PATH,
      markerPublished: true,
    });
    resetSessionStateForTests();
    await expect(getEnableStatus()).resolves.toBe("enabled");
  });

  it("is needs-enable after a failed Enable rolled the receiver secret back", async () => {
    await persistSessionMetadata({
      pubky: OWNER,
      exported: exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
    });
    resume.mockResolvedValue(
      fakeHandle(
        OWNER,
        exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
      ),
    );
    getReceiverNoiseSecret.mockResolvedValue(null);
    getReceiver.mockResolvedValue(null);
    resetSessionStateForTests();
    await expect(getEnableStatus()).resolves.toBe("needs-enable");
  });

  it("does not resurrect session metadata after a wipe", async () => {
    const { readSessionMetadata } = await import("./session");
    const pending = persistReceiverPath(OWNER, LINK_RECEIVER_PATH);
    await wipeSessionMetadata();
    await pending;
    await expect(readSessionMetadata()).resolves.toBeNull();
  });

  it("persistReceiverPath writes path evidence onto the current session record", async () => {
    await persistSessionMetadata({
      pubky: OWNER,
      exported: exportWithCaps("/pub/paykit/:rw", "/pub/hypercolor.app/v1/:rw"),
    });
    await persistReceiverPath(OWNER, LINK_RECEIVER_PATH);
    const { readSessionMetadata } = await import("./session");
    await expect(readSessionMetadata()).resolves.toMatchObject({
      pubky: OWNER,
      receiverPath: LINK_RECEIVER_PATH,
    });
  });
});
