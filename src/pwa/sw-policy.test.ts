import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isNextRscRequest, shouldInterceptForShellCache } from "./sw-policy";

function request(
  url: string,
  init: {
    method?: string;
    mode?: string;
    destination?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const headers = new Headers(init.headers);
  return {
    url,
    method: init.method ?? "GET",
    mode: init.mode,
    destination: init.destination,
    headers,
  };
}

describe("sw-policy: Next Flight requests must bypass the document cache", () => {
  it("treats an RSC-headered GET /chats as a Flight request", () => {
    expect(
      isNextRscRequest(
        request("https://hypercolor.app/chats", { headers: { RSC: "1" } }),
      ),
    ).toBe(true);
    expect(
      shouldInterceptForShellCache(
        request("https://hypercolor.app/chats", { headers: { RSC: "1" } }),
      ),
    ).toBe(false);
  });

  it("treats _rsc query and export .txt payloads as Flight requests", () => {
    expect(isNextRscRequest(request("https://hypercolor.app/chats?_rsc=abc"))).toBe(
      true,
    );
    expect(isNextRscRequest(request("https://hypercolor.app/chats.txt"))).toBe(
      true,
    );
    expect(
      isNextRscRequest(
        request("https://hypercolor.app/chats", {
          headers: { "Next-Router-State-Tree": "[]" },
        }),
      ),
    ).toBe(true);
  });

  it("still intercepts a real document navigation to /chats", () => {
    expect(
      shouldInterceptForShellCache(
        request("https://hypercolor.app/chats", { mode: "navigate" }),
      ),
    ).toBe(true);
    expect(
      shouldInterceptForShellCache(
        request("https://hypercolor.app/chats", { destination: "document" }),
      ),
    ).toBe(true);
  });

  it("does not intercept script or empty-destination fetches", () => {
    expect(
      shouldInterceptForShellCache(
        request("https://hypercolor.app/chats", { destination: "empty" }),
      ),
    ).toBe(false);
  });
});

describe("public/sw.js stays aligned with the Flight bypass", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/sw.js"),
    "utf8",
  );

  it("bypasses RSC / _rsc / .txt / router-state requests before cache-first", () => {
    expect(source).toContain("isNextRscRequest");
    expect(source).toContain('_rsc');
    expect(source).toContain(".txt");
    expect(source).toContain("Next-Router-State-Tree");
    expect(source).toMatch(/if \(isNextRscRequest\(event\.request\)\) return;/);
  });

  it("only cache-firsts document navigations, not every same-origin GET", () => {
    expect(source).toContain('event.request.mode !== "navigate"');
    expect(source).toContain('event.request.destination !== "document"');
  });

  it("does not precache HTML routes during install", () => {
    expect(source).toContain('cache.add(url)');
    expect(source).not.toMatch(/SHELL\.map\(\(url\) => cache\.add/);
    expect(source).toContain("/manifest.webmanifest");
  });
});
