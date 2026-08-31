import { describe, expect, it } from "vitest";
import {
  isFollowsImportEnabled,
  setFollowsImportEnabled,
} from "./followsImportPreference";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

function memoryStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
    removeItem(key: string) {
      delete data[key];
    },
    data,
  };
}

describe("followsImportPreference", () => {
  it("is off by default", () => {
    expect(isFollowsImportEnabled(OWNER, memoryStore())).toBe(false);
    expect(isFollowsImportEnabled("", memoryStore())).toBe(false);
    expect(isFollowsImportEnabled(OWNER, null)).toBe(false);
  });

  it("persists only a 1/absent toggle, never a follow list", () => {
    const store = memoryStore();
    setFollowsImportEnabled(OWNER, true, store);
    expect(isFollowsImportEnabled(OWNER, store)).toBe(true);
    expect(Object.values(store.data)).toEqual(["1"]);
    setFollowsImportEnabled(OWNER, false, store);
    expect(isFollowsImportEnabled(OWNER, store)).toBe(false);
    expect(store.data).toEqual({});
  });
});
