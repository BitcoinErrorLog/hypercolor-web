/**
 * Per-account opt-in for reading `/pub/pubky.app/follows/`.
 * Default off. Only the toggle is stored — never a follow list, pubky, or tag.
 *
 * Generation increments on disable so an in-flight import cannot write after
 * Stop, including disable-then-re-enable while that import is still looping.
 */

export const FOLLOWS_IMPORT_PREF_PREFIX = "hypercolor.followsImport.optIn.";

export type FollowsImportPreferenceStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const importGenerationByOwner = new Map<string, number>();

function defaultStore(): FollowsImportPreferenceStore | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function followsImportPrefKey(ownerPubky: string): string {
  return `${FOLLOWS_IMPORT_PREF_PREFIX}${ownerPubky}`;
}

export function followsImportGeneration(ownerPubky: string): number {
  return importGenerationByOwner.get(ownerPubky) ?? 0;
}

export function bumpFollowsImportGeneration(ownerPubky: string): number {
  if (!ownerPubky) return 0;
  const next = followsImportGeneration(ownerPubky) + 1;
  importGenerationByOwner.set(ownerPubky, next);
  return next;
}

export function isFollowsImportEnabled(
  ownerPubky: string,
  store: FollowsImportPreferenceStore | null = defaultStore(),
): boolean {
  if (!ownerPubky || !store) return false;
  return store.getItem(followsImportPrefKey(ownerPubky)) === "1";
}

export function setFollowsImportEnabled(
  ownerPubky: string,
  enabled: boolean,
  store: FollowsImportPreferenceStore | null = defaultStore(),
): void {
  if (!ownerPubky || !store) return;
  const key = followsImportPrefKey(ownerPubky);
  if (enabled) {
    store.setItem(key, "1");
    return;
  }
  store.removeItem(key);
  bumpFollowsImportGeneration(ownerPubky);
}
