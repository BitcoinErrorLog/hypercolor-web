import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import {
  classifyHarnessHookInSource,
  shouldAssertProductionOut,
  findE2eHarnessHookSymbols,
  listE2eHarnessHookSymbols,
  listHarnessHookSourceFiles,
} from "./e2e-harness-symbols.mjs";

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
    const rootResolved = path.resolve(root);
    const assertInsideOrMissing = (urlPath) => {
      const file = resolveOutFile(root, urlPath);
      if (file === null || file === BAD_URL_ENCODING) return;
      const rel = path.relative(rootResolved, file);
      expect(rel.startsWith("..") || path.isAbsolute(rel)).toBe(false);
    };
    expect(resolveOutFile(root, "/../package.json")).toBeNull();
    expect(resolveOutFile(root, "/%2e%2e/package.json")).toBeNull();
    expect(resolveOutFile(root, "/%252e%252e/package.json")).toBeNull();
    expect(resolveOutFile(root, "/..%5cpackage.json")).toBeNull();
    assertInsideOrMissing("/foo/bar/../..");
    assertInsideOrMissing("/..");
  });

  it("parses CACHE from public/sw.js as the single source of truth", () => {
    const parse = (file) => {
      const match = readFileSync(file, "utf8").match(/^\s*const CACHE = "([^"]+)";/m);
      if (!match?.[1]) throw new Error(`no CACHE in ${file}`);
      return match[1];
    };
    const current = parse(path.join(REPO_ROOT, "public", "sw.js"));
    const v3 = parse(path.join(REPO_ROOT, "e2e", "fixtures", "sw-v3.js"));
    expect(current).toBe("hypercolor-shell-v4");
    expect(v3).toBe("hypercolor-shell-v3");
    expect(current).not.toBe(v3);
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

  it("refuses an unmarked export whose chunks contain a harness hook symbol", async () => {
    const symbols = listE2eHarnessHookSymbols(REPO_ROOT);
    expect(symbols).toContain("__hypercolorSetBackupGate");
    expect(symbols).toContain("__hypercolorShowRecovery");
    const root = tempDir();
    writeFileSync(path.join(root, "index.html"), "<html>unmarked</html>");
    mkdirSync(path.join(root, "_next", "static", "chunks"), { recursive: true });
    writeFileSync(
      path.join(root, "_next", "static", "chunks", "fake.js"),
      `window.__hypercolorSetBackupGate=function(){}`,
    );
    await expect(startStaticPreview({ root, port: 0, rewrites: [] })).rejects.toThrow(
      /unmarked e2e-harness|__hypercolorSetBackupGate/,
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
    } finally {
      await preview.close();
    }
  });

  it("derives harness hook source files by scanning src/ and app/", () => {
    const files = listHarnessHookSourceFiles(REPO_ROOT);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.startsWith("src/") || f.startsWith("app/"))).toBe(true);
    const symbols = listE2eHarnessHookSymbols(REPO_ROOT);
    expect(symbols).toContain("__vibewareSink");
  });

  it("production out/ has no live __hypercolor hook registration", () => {
    const out = path.join(REPO_ROOT, "out");
    if (!existsSync(out)) {
      if (shouldAssertProductionOut()) {
        throw new Error(
          "production out/ is missing — run npm run build before this assertion",
        );
      }
      return;
    }
    if (existsSync(path.join(out, E2E_HARNESS_MARKER))) {
      throw new Error("production out/ still carries the e2e-harness marker");
    }
    const symbols = listE2eHarnessHookSymbols(REPO_ROOT);
    expect(symbols.length).toBeGreaterThan(0);
    const hits = findE2eHarnessHookSymbols(out, symbols);
    const live = [];
    for (const hit of hits) {
      const source = readFileSync(hit.file, "utf8");
      const kind = classifyHarnessHookInSource(source, hit.symbol);
      if (kind === "live") {
        live.push(`${hit.symbol} in ${hit.file}`);
        expect(source, `${hit.symbol} in ${hit.file}`).toMatch(
          /NEXT_PUBLIC_E2E_HARNESS|__HYPERCOLOR_E2E_HARNESS__/,
        );
      }
    }
    expect(live, live.join(", ")).toEqual([]);
  }, 60_000);

  it("CI=true alone does not assert production out/", () => {
    expect(shouldAssertProductionOut({ CI: "true" })).toBe(false);
    expect(shouldAssertProductionOut({})).toBe(false);
    expect(shouldAssertProductionOut({ HYPERCOLOR_ASSERT_PRODUCTION_OUT: "1" })).toBe(true);
  });

  it("production out missing throws only when HYPERCOLOR_ASSERT_PRODUCTION_OUT=1", () => {
    const decide = (env) => {
      const outExists = false;
      if (outExists) return "assert";
      if (shouldAssertProductionOut(env)) {
        throw new Error("production out/ is missing — run npm run build before this assertion");
      }
      return "skip";
    };
    expect(decide({ CI: "true" })).toBe("skip");
    expect(() => decide({ HYPERCOLOR_ASSERT_PRODUCTION_OUT: "1" })).toThrow(
      /production out\/ is missing/,
    );
  });

  it("classifyHarnessHookInSource keeps real assignments live and quoted equals inert", () => {
    const symbol = "__hypercolorSetBackupGate";
    expect(classifyHarnessHookInSource(`window.${symbol}=function(){}`, symbol)).toBe("live");
    expect(classifyHarnessHookInSource(`.${symbol}=1`, symbol)).toBe("live");
    expect(classifyHarnessHookInSource(`${symbol}=1`, symbol)).toBe("live");
    expect(classifyHarnessHookInSource(`window["${symbol}"]=1`, symbol)).toBe("live");
    expect(classifyHarnessHookInSource(`window['${symbol}']=1`, symbol)).toBe("live");
    expect(classifyHarnessHookInSource(`const msg = "${symbol}=";`, symbol)).toBe("inert");
    expect(classifyHarnessHookInSource(`const msg = '${symbol}=';`, symbol)).toBe("inert");
    expect(classifyHarnessHookInSource("nope", symbol)).toBe("absent");
  });
});
