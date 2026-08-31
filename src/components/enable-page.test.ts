import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { clearEnableCompleted } from "@/lib/enable-done";
import { useSessionStatusStore } from "@/stores/sessionStatusStore";
import { EnablePage } from "./enable-page";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "enable-page.tsx"),
  "utf8",
);
const host = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../services/onboarding/enableActions.tsx",
  ),
  "utf8",
);
const pathId = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/path-id.ts"),
  "utf8",
);
const chatsOpen = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/chats-open.ts"),
  "utf8",
);
const enableDone = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/enable-done.ts"),
  "utf8",
);

const idle = {
  offline: false,
  isLoading: false,
  isExpired: false,
  error: null,
  identityLabel: null,
  provisionedPath: null,
  authPanel: null as ReactNode,
  onRegenerate: () => {},
  onRetry: () => {},
  onSignOut: () => {},
  onOpenChats: () => {},
};

function StoreEnablePage() {
  const status = useSessionStatusStore((s) => s.status);
  const enabled = status.kind === "enabled";
  return createElement(EnablePage, {
    ...idle,
    enabled,
    showOpenChats: enabled,
  });
}

describe("enable-page Open chats", () => {
  it("opens chats in the live Enable module and stamps __NA so Next does not start Flight", () => {
    expect(source).toContain('type="button"');
    expect(source).toContain("onOpenChats");
    expect(source).not.toContain("<Link");
    expect(source).not.toContain("location.assign");
    expect(source).not.toContain("router.push");
    expect(host).toContain("ChatsPageHost");
    expect(host).toMatch(/\{enabled && chatsMounted \?\s*\([\s\S]*<ChatsPageHost \/>/);
    expect(host).toContain("setChatsMounted(true)");
    expect(host.indexOf("setChatsMounted(true)")).toBeGreaterThan(host.indexOf("onOpenChats"));
    expect(host).toContain("setChatsOpen(true)");
    expect(host).toContain("startTransition");
    expect(host).toContain("setChatsMounted(true)");
    expect(host).toContain("markChatsRequested()");
    expect(host).toContain("isChatsRequested()");
    expect(host).toContain("showOpenChats={!chatsVisible}");
    expect(source).toContain("useSessionStatusStore");
    expect(source).toContain("storeKind === \"enabled\" || enabledProp");
    expect(host).toContain("setError(err instanceof Error ? err.message : \"Authorization failed\")");
    expect(host).toContain("const enabled = status.kind === \"enabled\"");
    expect(host).not.toContain("useEnableCompleted");
    expect(host).not.toContain("enableDone");
    expect(host).toContain('"use no memo"');
    expect(host).toContain("flushSync");
    expect(host).toContain("setEnabled(result.pubky)");
    expect(host).not.toContain("markEnableCompleted(result.pubky)");
    expect(host).toContain("inert: true");
    expect(host).toContain("stampAppPath(\"/chats\")");
    expect(source).toContain("showOpenChats");
    expect(host).not.toContain("setTimeout");
    expect(host).not.toContain("pushAppPath");
    expect(host).not.toContain("router.push");
    expect(host).not.toContain("location.assign");
    expect(chatsOpen).toContain("sessionStorage");
    expect(chatsOpen).toContain("chatsRequested");
    expect(pathId).toContain("export function stampAppPath");
    expect(pathId).toContain("__NA: true");
    expect(enableDone).not.toContain("querySelectorAll");
    expect(enableDone).not.toContain("textContent");
    expect(enableDone).toContain("useState(() => isEnableCompleted())");
  });
});

describe("enable-page first paint", () => {
  afterEach(() => {
    clearEnableCompleted();
    useSessionStatusStore.setState({ status: { kind: "unknown" } });
  });

  it("paints Encrypted messaging enabled and Open chats on the first render", () => {
    const html = renderToString(
      createElement(EnablePage, { ...idle, enabled: true, showOpenChats: true }),
    );
    expect(html).toContain("Encrypted messaging enabled");
    expect(html).toContain("enableOpenChats");
    expect(html).not.toContain("Waiting for Pubky Ring…");
  });

  it("paints Waiting and no Open chats when not enabled", () => {
    const html = renderToString(
      createElement(EnablePage, { ...idle, enabled: false, showOpenChats: false }),
    );
    expect(html).toContain("Waiting for Pubky Ring…");
    expect(html).not.toContain("enableOpenChats");
    expect(html).not.toContain("Encrypted messaging enabled");
  });

  it("first render after setEnabled shows enabled without waiting for an effect", () => {
    useSessionStatusStore.getState().setEnabled("pk:paint");
    const html = renderToString(createElement(StoreEnablePage));
    expect(html).toContain("Encrypted messaging enabled");
    expect(html).toContain("enableOpenChats");
    expect(html).not.toContain("Waiting for Pubky Ring…");
  });

  it("first render after remount still shows enabled from the pinned store", () => {
    useSessionStatusStore.getState().setEnabled("pk:remount");
    renderToString(createElement(StoreEnablePage));
    const html = renderToString(createElement(StoreEnablePage));
    expect(html).toContain("Encrypted messaging enabled");
    expect(html).toContain("enableOpenChats");
  });
});
