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
