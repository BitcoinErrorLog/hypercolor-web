import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  BAD_URL_ENCODING,
  E2E_HARNESS_MARKER,
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

  it("returns a sentinel for malformed percent encoding", () => {
    const root = tempDir();
    writeFileSync(path.join(root, "index.html"), "ok");
    expect(resolveOutFile(root, "/%E0%A4%A")).toBe(BAD_URL_ENCODING);
  });

  it("survives a malformed request and keeps serving", async () => {
    const root = tempDir();
    writeFileSync(path.join(root, "index.html"), "<html>ok</html>");
    const preview = await startStaticPreview({ root, port: 0, rewrites: [] });
    const rawGet = (urlPath) =>
      new Promise((resolve, reject) => {
        const parsed = new URL(preview.url);
        const req = http.request(
          {
            hostname: parsed.hostname,
            port: parsed.port,
            path: urlPath,
            method: "GET",
          },
          (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );
        req.on("error", reject);
        req.end();
      });
    try {
      const bad = await rawGet("/%E0%A4%A");
      expect(bad.status).toBe(400);
      expect(bad.body).toMatch(/Bad request/i);
      const ok = await rawGet("/");
      expect(ok.status).toBe(200);
      expect(ok.body).toContain("ok");
    } finally {
      await preview.close();
    }
  });

  it("refuses an e2e-harness export unless explicitly allowed", async () => {
    const root = tempDir();
    writeFileSync(path.join(root, "index.html"), "<html>harness</html>");
    writeFileSync(path.join(root, E2E_HARNESS_MARKER), "NEXT_PUBLIC_E2E_HARNESS=1\n");
    await expect(startStaticPreview({ root, port: 0, rewrites: [] })).rejects.toThrow(
      /e2e-harness/,
    );
    const preview = await startStaticPreview({
      root,
      port: 0,
      rewrites: [],
      allowE2eHarness: true,
    });
    try {
      const res = await fetch(`${preview.url}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("harness");
    } finally {
      await preview.close();
    }
  });
});
