import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_ALGORITHM,
  AttachmentError,
  buildAttachmentLocation,
  buildAttachmentThumbLocation,
} from "../../types/attachment";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const OTHER = "p1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const ATTACHMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CIPHERTEXT_B64 = "dGVzdC1jaXBoZXJ0ZXh0";

const putPublic = vi.fn();
const deletePublic = vi.fn();
const publicGet = vi.fn();
let live: { pubky: string; handle: { putPublic: typeof putPublic } } | null = null;

vi.mock("../link/PaykitLinkWeb", async () => {
  const actual = await vi.importActual<typeof import("../link/PaykitLinkWeb")>(
    "../link/PaykitLinkWeb",
  );
  return {
    ...actual,
    PaykitLinkWeb: {
      putPublic: (...args: unknown[]) => putPublic(...args),
      deletePublic: (...args: unknown[]) => deletePublic(...args),
      publicGet: (...args: unknown[]) => publicGet(...args),
    },
  };
});

vi.mock("../link/session", () => ({
  getLiveSession: () => live,
}));

import {
  attachmentHomeserverTarget,
  deleteAttachmentCiphertext,
  getAttachmentCiphertext,
  putAttachmentCiphertext,
} from "./homeserver";
import {
  encryptAndPutAttachment,
  getAndDecryptAttachment,
} from "./AttachmentService";
import { attachmentEncrypt, generateAttachmentKey } from "./xchacha";
import { base64urlnopad } from "@scure/base";

function location(): string {
  return buildAttachmentLocation(OWNER, ATTACHMENT_ID);
}

describe("attachment homeserver transport", () => {
  beforeEach(() => {
    putPublic.mockReset().mockResolvedValue(undefined);
    deletePublic.mockReset().mockResolvedValue(undefined);
    publicGet.mockReset().mockResolvedValue(undefined);
    live = {
      pubky: OWNER,
      handle: { putPublic },
    };
  });

  afterEach(() => {
    live = null;
  });

  it("maps a canonical location to /pub/hypercolor.app/v1/attachments/{uuid}", () => {
    expect(attachmentHomeserverTarget(location())).toEqual({
      ownerPubky: OWNER,
      path: `/pub/hypercolor.app/v1/attachments/${ATTACHMENT_ID}`,
    });
    expect(
      attachmentHomeserverTarget(buildAttachmentThumbLocation(OWNER, ATTACHMENT_ID)),
    ).toEqual({
      ownerPubky: OWNER,
      path: `/pub/hypercolor.app/v1/attachments/${ATTACHMENT_ID}.thumb`,
    });
  });

  it("rejects a non-canonical location", () => {
    expect(() => attachmentHomeserverTarget("https://example/file")).toThrow(
      AttachmentError,
    );
  });

  it("PUTs UTF-8 ciphertext via the live session", async () => {
    await putAttachmentCiphertext(location(), CIPHERTEXT_B64);
    expect(putPublic).toHaveBeenCalledTimes(1);
    expect(putPublic).toHaveBeenCalledWith(
      live!.handle,
      `/pub/hypercolor.app/v1/attachments/${ATTACHMENT_ID}`,
      new TextEncoder().encode(CIPHERTEXT_B64),
    );
  });

  it("refuses PUT when no session is live", async () => {
    live = null;
    await expect(putAttachmentCiphertext(location(), CIPHERTEXT_B64)).rejects.toMatchObject(
      { name: "AttachmentError", code: "unavailable" },
    );
    expect(putPublic).not.toHaveBeenCalled();
  });

  it("refuses PUT when the session pubky does not own the location", async () => {
    live = { pubky: OTHER, handle: { putPublic } };
    await expect(putAttachmentCiphertext(location(), CIPHERTEXT_B64)).rejects.toMatchObject(
      { name: "AttachmentError", code: "validation" },
    );
    expect(putPublic).not.toHaveBeenCalled();
  });

  it("maps a network put failure", async () => {
    putPublic.mockRejectedValueOnce(Object.assign(new Error("failed to fetch"), { name: "NetworkError" }));
    await expect(putAttachmentCiphertext(location(), CIPHERTEXT_B64)).rejects.toMatchObject(
      { name: "AttachmentError", code: "network" },
    );
  });

  it("GETs ciphertext via wasm publicGet and treats missing as null", async () => {
    publicGet.mockResolvedValueOnce(new TextEncoder().encode(CIPHERTEXT_B64));
    await expect(getAttachmentCiphertext(location())).resolves.toBe(CIPHERTEXT_B64);
    expect(publicGet).toHaveBeenCalledWith(
      OWNER,
      `/pub/hypercolor.app/v1/attachments/${ATTACHMENT_ID}`,
    );

    publicGet.mockResolvedValueOnce(undefined);
    await expect(getAttachmentCiphertext(location())).resolves.toBeNull();
  });

  it("DELETE uses the live session path", async () => {
    await deleteAttachmentCiphertext(location());
    expect(deletePublic).toHaveBeenCalledWith(
      live!.handle,
      `/pub/hypercolor.app/v1/attachments/${ATTACHMENT_ID}`,
    );
  });

  it("encryptAndPut zeroizes plaintext and stores only ciphertext", async () => {
    const store = new Map<string, Uint8Array>();
    putPublic.mockImplementation(async (_session, path: string, body: Uint8Array) => {
      store.set(path, new Uint8Array(body));
    });
    publicGet.mockImplementation(async (_owner: string, path: string) => store.get(path));

    const plaintext = new TextEncoder().encode("attachment-bytes");
    const copy = new Uint8Array(plaintext);
    const uploaded = await encryptAndPutAttachment(plaintext);
    expect(plaintext).toEqual(new Uint8Array(plaintext.length));
    expect(uploaded.algorithm).toBe(ATTACHMENT_ALGORITHM);
    expect(uploaded.size).toBe(copy.byteLength);
    expect(uploaded.location).toBe(
      buildAttachmentLocation(OWNER, uploaded.attachmentId),
    );

    const stored = store.get(
      `/pub/hypercolor.app/v1/attachments/${uploaded.attachmentId}`,
    );
    expect(stored).toBeTruthy();
    const storedText = new TextDecoder().decode(stored);
    expect(storedText).not.toContain("attachment-bytes");

    const opened = await getAndDecryptAttachment(
      uploaded.location,
      uploaded.key,
      uploaded.nonce,
    );
    expect(opened).toEqual(copy);
  });

  it("getAndDecrypt rejects a missing blob", async () => {
    publicGet.mockResolvedValueOnce(undefined);
    const key = generateAttachmentKey();
    const sealed = attachmentEncrypt(
      base64urlnopad.encode(new TextEncoder().encode("x")),
      key,
      location(),
    );
    await expect(
      getAndDecryptAttachment(location(), key, sealed.nonceB64),
    ).rejects.toMatchObject({ name: "AttachmentError", code: "not-found" });
  });
});
