import { afterEach, describe, expect, it } from "vitest";
import { COHORT_STORAGE_KEY, clearCohortKey, getCohortKey } from "./cohort";

describe("vibeware cohort key", () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return memory.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
    },
    removeItem(key: string) {
      memory.delete(key);
    },
  };

  afterEach(() => {
    memory.clear();
    clearCohortKey({ storage });
  });

  it("clearCohortKey drops the stored secret so the next actor is a new cohort", async () => {
    const first = await getCohortKey({ storage, origin: "https://hypercolor.app" });
    const stored = memory.get(COHORT_STORAGE_KEY);
    expect(stored).toMatch(/^[0-9a-f]{32}$/i);
    const again = await getCohortKey({ storage, origin: "https://hypercolor.app" });
    expect(again).toBe(first);
    clearCohortKey({ storage });
    expect(memory.has(COHORT_STORAGE_KEY)).toBe(false);
    const rotated = await getCohortKey({ storage, origin: "https://hypercolor.app" });
    expect(rotated).not.toBe(first);
  });
});
