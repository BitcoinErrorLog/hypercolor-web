import { afterEach, describe, expect, it } from "vitest";
import { isE2eHarnessEnabled } from "./e2e-harness";

describe("isE2eHarnessEnabled", () => {
  const previous = process.env.NEXT_PUBLIC_E2E_HARNESS;

  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_E2E_HARNESS;
    else process.env.NEXT_PUBLIC_E2E_HARNESS = previous;
  });

  it("is off unless NEXT_PUBLIC_E2E_HARNESS=1", () => {
    delete process.env.NEXT_PUBLIC_E2E_HARNESS;
    expect(isE2eHarnessEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_E2E_HARNESS = "0";
    expect(isE2eHarnessEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_E2E_HARNESS = "1";
    expect(isE2eHarnessEnabled()).toBe(true);
  });
});
