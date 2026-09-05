/**
 * Stamp stored next to the IDB sqlite blob so a later bundle can see which
 * schema generation wrote the snapshot. Not a secret.
 */
export const SQLITE_BUNDLE_ID =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SQLITE_BUNDLE_ID) ||
  "hypercolor-web-schema-v14";
