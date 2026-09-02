/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThreadView } from "@/components/thread-view";
import {
  peekThreadOrigin,
  rememberThreadOrigin,
  takeThreadOrigin,
} from "@/lib/list-detail-focus";

vi.mock("next/navigation", () => ({
  usePathname: () => "/chats",
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    back: () => undefined,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

let host: HTMLDivElement;
let root: Root;

function stubMatchMedia(matches = false) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

async function renderThread(props?: Partial<Parameters<typeof ThreadView>[0]>) {
  await act(async () => {
    root.render(
      <ThreadView
        conversationId={`dm:${OWNER}`}
        participantPubky={OWNER}
        displayName="Ada"
        localPubky={null}
        messages={[]}
        attachments={[]}
        loading={false}
        error={null}
        draft=""
        sending={false}
        status={{ kind: "no-identity" }}
        enableCta={null}
        renderAttachment={() => null}
        onChangeDraft={() => undefined}
        onSend={() => undefined}
        onAttach={() => undefined}
        onRetry={() => undefined}
        onResolved={() => undefined}
        {...props}
      />,
    );
  });
}

describe("ThreadView origin snapshot", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    stubMatchMedia(false);
    sessionStorage.clear();
    takeThreadOrigin();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    sessionStorage.clear();
    takeThreadOrigin();
  });

  it("renders with a stored chats origin and labels Back to Chats", async () => {
    sessionStorage.setItem("hypercolor.thread-origin", JSON.stringify({ kind: "chats" }));
    expect(peekThreadOrigin()).toBe(peekThreadOrigin());
    await renderThread();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.querySelector("[data-testid=threadScreen]")).not.toBeNull();
    expect(host.querySelector("[data-testid=detailBack]")?.getAttribute("aria-label")).toBe(
      "Back to Chats",
    );
  });

  it("renders with a stored contact origin and labels Back to Contact", async () => {
    rememberThreadOrigin({ kind: "contact", pubky: OWNER });
    await renderThread();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.querySelector("[data-testid=threadScreen]")).not.toBeNull();
    expect(host.querySelector("[data-testid=detailBack]")?.getAttribute("aria-label")).toBe(
      "Back to Contact",
    );
  });
});
