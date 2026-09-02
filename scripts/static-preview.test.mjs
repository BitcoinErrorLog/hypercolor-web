import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadVercelRewrites,
  matchRewrite,
  resolveOutFile,
  startStaticPreview,
} from "./static-preview.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temps = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "hc-static-preview-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("static preview rewrites", () => {
  it("loads the repository vercel.json nested-route rules", () => {
    const rewrites = loadVercelRewrites(REPO_ROOT);
    expect(rewrites).toEqual([
      { source: "/chats/:conversationId", destination: "/chats" },
      { source: "/channels/:id", destination: "/channels" },
      { source: "/contacts/:pubky", destination: "/contacts" },
      { source: "/discover/:tag", destination: "/discover" },
    ]);
  });

  it("maps nested chat and contact paths, including encoded conversation ids", () => {
    const rewrites = loadVercelRewrites(REPO_ROOT);
    expect(matchRewrite("/chats", rewrites)).toBeNull();
    expect(matchRewrite("/chats/dm:abc", rewrites)).toBe("/chats");
    expect(
      matchRewrite(`/chats/${encodeURIComponent("dm:o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq")}`, rewrites),
    ).toBe("/chats");
    expect(matchRewrite("/contacts/o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq", rewrites)).toBe(
      "/contacts",
    );
    expect(matchRewrite("/channels/group-1", rewrites)).toBe("/channels");
    expect(matchRewrite("/discover/bitcoin", rewrites)).toBe("/discover");
    expect(matchRewrite("/_next/static/chunk.js", rewrites)).toBeNull();
  });

  it("serves rewritten nested paths from the destination html", async () => {
    const root = tempDir();
    writeFileSync(path.join(root, "chats.html"), "<html>chats-shell</html>");
    mkdirSync(path.join(root, "chats"));
    const preview = await startStaticPreview({
      root,
      port: 0,
      rewrites: loadVercelRewrites(REPO_ROOT),
    });
    try {
      const conversation = encodeURIComponent("dm:o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq");
      const res = await fetch(`${preview.url}/chats/${conversation}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("chats-shell");
      const list = await fetch(`${preview.url}/chats`);
      expect(list.status).toBe(200);
      expect(await list.text()).toContain("chats-shell");
    } finally {
      await preview.close();
    }
  });

  it("refuses path traversal", () => {
    const root = tempDir();
    writeFileSync(path.join(root, "index.html"), "ok");
    expect(resolveOutFile(root, "/../package.json")).toBeNull();
  });
});
