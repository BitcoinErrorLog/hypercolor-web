const DEFAULT_DISPLAY_PUBLIC_KEY_LENGTH = 8;
const PUBKY_PREFIX = "pubky";

export function stripPubkyPrefix(key: string): string {
  if (!key) return "";
  if (key.startsWith(`${PUBKY_PREFIX}:`)) return key.slice(PUBKY_PREFIX.length + 1);
  return key;
}

export function formatPublicKey({
  key,
  length = DEFAULT_DISPLAY_PUBLIC_KEY_LENGTH,
  includePrefix = false,
}: {
  key: string;
  length?: number;
  includePrefix?: boolean;
}): string {
  if (!key) return "";
  const rawKey = stripPubkyPrefix(key);
  const prefixLabel = includePrefix ? `${PUBKY_PREFIX}:` : "";
  if (rawKey.length <= length) return `${prefixLabel}${rawKey}`;
  const prefix = rawKey.slice(0, Math.floor(length / 2));
  const suffix = rawKey.slice(-(length - prefix.length));
  return `${prefixLabel}${prefix}...${suffix}`;
}
