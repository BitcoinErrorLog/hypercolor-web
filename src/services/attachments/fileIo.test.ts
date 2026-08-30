import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachmentCacheDirectory,
  attachmentCachePath,
  attachmentThumbCachePath,
  cacheFileExists,
  cachePathsForAttachment,
  decodedBase64Bytes,
  deleteCacheFiles,
  fromBase64Url,
  readFileAsStandardBase64,
  toBase64Url,
  writeFileFromStandardBase64,
} from "./fileIo";

const OWNER = "a".repeat(52);
const SENDER = "z".repeat(52);
const EVENT = "00000000-0000-4000-8000-000000000001";

describe("attachment fileIo", () => {
  const previous = process.env.HYPERCOLOR_ATTACHMENT_CACHE;

  afterEach(() => {
    if (previous === undefined) delete process.env.HYPERCOLOR_ATTACHMENT_CACHE;
    else process.env.HYPERCOLOR_ATTACHMENT_CACHE = previous;
  });

  it("converts standard base64 to base64url and back", () => {
    const standard = Buffer.from("hello+/=").toString("base64");
    const url = toBase64Url(standard);
    expect(url).not.toMatch(/[+/=]/);
    expect(fromBase64Url(url)).toBe(standard);
  });

  it("counts decoded bytes from padded or url-safe input", () => {
    const standard = Buffer.from("abcd").toString("base64");
    expect(decodedBase64Bytes(standard)).toBe(4);
    expect(decodedBase64Bytes(toBase64Url(standard))).toBe(4);
  });

  it("builds cache paths with the same export names as mobile", () => {
    const dir = attachmentCacheDirectory(OWNER);
    expect(dir).toContain("hypercolor-attachments");
    expect(dir.endsWith(`${OWNER}/`) || dir.endsWith(`${OWNER}\\`)).toBe(true);
    const primary = attachmentCachePath(OWNER, SENDER, EVENT);
    expect(primary.startsWith(dir)).toBe(true);
    expect(primary.endsWith(EVENT)).toBe(true);
    expect(attachmentThumbCachePath(OWNER, SENDER, EVENT)).toBe(
      `${primary}.thumb`,
    );
    expect(
      cachePathsForAttachment({
        ownerPubky: OWNER,
        senderPubky: SENDER,
        eventId: EVENT,
        localCachePath: "file:///cache/extra",
      }),
    ).toEqual(
      expect.arrayContaining([
        primary,
        `${primary}.thumb`,
        "file:///cache/extra",
        "file:///cache/extra.thumb",
      ]),
    );
  });

  it("writes, reads, and deletes files on the Node temp-dir fallback", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hc-fileio-"));
    process.env.HYPERCOLOR_ATTACHMENT_CACHE = tmp;
    const target = attachmentCachePath(OWNER, SENDER, EVENT);
    const payload = Buffer.from("attachment-bytes").toString("base64");

    expect(await cacheFileExists(target)).toBe(false);
    await writeFileFromStandardBase64(target, payload);
    expect(await cacheFileExists(target)).toBe(true);

    const read = await readFileAsStandardBase64(target);
    expect(read.base64).toBe(payload);
    expect(read.size).toBe(decodedBase64Bytes(payload));

    await deleteCacheFiles([target, `${target}.thumb`, null]);
    expect(await cacheFileExists(target)).toBe(false);
    await expect(readFileAsStandardBase64(target)).rejects.toThrow(
      /attachment file not found/,
    );
  });
});
