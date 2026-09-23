/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Composer } from "@/components/composer";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(draft: string, onSend: () => void, onChangeDraft: (value: string) => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <Composer
        draft={draft}
        sending={false}
        placeholder="Message"
        onChangeDraft={onChangeDraft}
        onSend={onSend}
        testIdPrefix="thread"
      />,
    );
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

describe("composer GIF entry", () => {
  it("omits the GIF button and any not-configured copy when search is off", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <Composer
          draft=""
          sending={false}
          placeholder="Message"
          onChangeDraft={() => {}}
          onSend={() => {}}
          testIdPrefix="thread"
          gifConfigured={false}
          onPickGif={() => {}}
          initialGifOpen
        />,
      );
    });
    expect(host.querySelector('[data-testid="threadGif"]')).toBeNull();
    expect(host.textContent).not.toContain("GIF search not configured");
    expect(host.textContent).not.toContain("GIF");
  });

  it("shows the GIF button only when search is configured", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <Composer
          draft=""
          sending={false}
          placeholder="Message"
          onChangeDraft={() => {}}
          onSend={() => {}}
          testIdPrefix="thread"
          gifConfigured
          onPickGif={() => {}}
        />,
      );
    });
    expect(host.querySelector('[data-testid="threadGif"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Insert GIF"]')?.hasAttribute("disabled")).toBe(false);
  });
});

describe("composer Enter-to-send", () => {
  it("submits on Enter and does not submit on Shift+Enter or IME composition", () => {
    const sends: string[] = [];
    mount("hello", () => sends.push("sent"), () => undefined);
    const textarea = host!.querySelector('[data-testid="threadDraft"]') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(sends).toEqual(["sent"]);

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(sends).toEqual(["sent"]);

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }),
      );
    });
    expect(sends).toEqual(["sent"]);
  });
});
