/**
 * Per-account opt-in for reading `/pub/pubky.app/follows/`.
 * Default off. Only the toggle is stored — never a follow list, pubky, or tag.
 */

export const FOLLOWS_IMPORT_PREF_PREFIX = "hypercolor.followsImport.optIn.";

export type FollowsImportPreferenceStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

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
  if (enabled) store.setItem(key, "1");
  else store.removeItem(key);
}
