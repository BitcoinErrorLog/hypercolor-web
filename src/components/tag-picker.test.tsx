/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TagPicker } from "@/components/tag-picker";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<TagPicker open onClose={() => undefined} onPick={() => undefined} />);
  });
}

function enter(value: string) {
  const input = host!.querySelector('input[aria-label="Word tag"]') as HTMLInputElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return input;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("TagPicker validation", () => {
  it("disables bad-tag with an inline error and accepts a word and pasted emoji", () => {
    mount();
    const submit = () => host!.querySelector('button[type="submit"]') as HTMLButtonElement;

    enter("bad-tag");
    expect(submit().disabled).toBe(true);
    expect(host!.querySelector('[role="alert"]')?.textContent).toContain("Use 1–32");

    enter("good_tag");
    expect(submit().disabled).toBe(false);

    enter("🏴󠁧󠁢󠁥󠁮󠁧󠁿");
    expect(submit().disabled).toBe(false);
  });
});
