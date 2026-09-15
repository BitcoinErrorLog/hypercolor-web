import {
  isolateFirstStrong,
  stripBidiAndC1,
  truncateWithEllipsis,
} from "@/utils/displaySanitize";

export const PUBLIC_POST_DISPLAY_MAX_CHARS = 480;
export const PUBLIC_NAME_DISPLAY_MAX_CHARS = 64;
export const PUBLIC_BIO_DISPLAY_MAX_CHARS = 140;
export const PUBLIC_TAG_DISPLAY_MAX_CHARS = 48;

/** Nexus and homeserver text at render — never raw. */
export function sanitizePublicText(raw: string, maxChars: number): string {
  return isolateFirstStrong(truncateWithEllipsis(stripBidiAndC1(raw), maxChars));
}

export function sanitizePublicName(raw: string): string {
  return sanitizePublicText(raw, PUBLIC_NAME_DISPLAY_MAX_CHARS);
}

export function sanitizePublicBio(raw: string): string {
  return sanitizePublicText(raw, PUBLIC_BIO_DISPLAY_MAX_CHARS);
}

export function sanitizePublicPost(raw: string): string {
  return sanitizePublicText(raw, PUBLIC_POST_DISPLAY_MAX_CHARS);
}

export function sanitizePublicTag(raw: string): string {
  return sanitizePublicText(raw, PUBLIC_TAG_DISPLAY_MAX_CHARS);
}
