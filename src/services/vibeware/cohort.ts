export const COHORT_PREFIX = "hypercolor-web/cohort/v1";
export const COHORT_STORAGE_KEY = "hypercolor.vibeware.cohort.v1";

export type CohortStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

const memoryStorage = new Map<string, string>();

const fallbackStorage: CohortStorage = {
  getItem(key) {
    return memoryStorage.get(key) ?? null;
  },
  setItem(key, value) {
    memoryStorage.set(key, value);
  },
  removeItem(key) {
    memoryStorage.delete(key);
  },
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function random128BitHexFromStorage(stored: string | null): Uint8Array {
  if (typeof stored === "string" && /^[0-9a-f]{32}$/i.test(stored)) {
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) {
      out[i] = Number.parseInt(stored.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  const next = new Uint8Array(16);
  crypto.getRandomValues(next);
  return next;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export async function getCohortKey(options?: {
  storage?: CohortStorage;
  origin?: string;
}): Promise<string> {
  const storage =
    options?.storage ??
    (typeof localStorage !== "undefined" ? localStorage : fallbackStorage);
  const origin =
    options?.origin ?? (typeof location !== "undefined" ? location.origin : "");
  const secret = random128BitHexFromStorage(storage.getItem(COHORT_STORAGE_KEY));
  storage.setItem(COHORT_STORAGE_KEY, toHex(secret));
  const material = concatBytes([
    new TextEncoder().encode(COHORT_PREFIX),
    new TextEncoder().encode(origin),
    secret,
  ]);
  const digestBuffer = new ArrayBuffer(material.byteLength);
  new Uint8Array(digestBuffer).set(material);
  const digest = await crypto.subtle.digest("SHA-256", digestBuffer);
  return toHex(new Uint8Array(digest));
}

/** Drop the per-origin cohort secret so the next identity cannot reuse it. */
export function clearCohortKey(options?: { storage?: CohortStorage }): void {
  const storage =
    options?.storage ??
    (typeof localStorage !== "undefined" ? localStorage : fallbackStorage);
  if (typeof storage.removeItem === "function") {
    storage.removeItem(COHORT_STORAGE_KEY);
  }
  memoryStorage.delete(COHORT_STORAGE_KEY);
}
