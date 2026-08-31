import { isValidPubky, parsePubky } from "@/utils/pubkyId";

export const TAG_LABEL_MAX_CHARS = 64;
const TAG_LABEL_RE = /^[\p{L}\p{N}_.+-]+$/u;

export type PostKeyParts = {
  author: string;
  postId: string;
};

/**
 * `search/posts/by_tag` returns `author_id:post_id`.
 * Reject anything that is not a pubky author plus a non-empty id.
 */
export function parsePostKey(raw: unknown): PostKeyParts | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const colon = raw.indexOf(":");
  if (colon <= 0 || colon === raw.length - 1) return null;
  const author = parsePubky(raw.slice(0, colon));
  const postId = raw.slice(colon + 1).trim();
  if (!author || postId.length === 0) return null;
  if (postId.includes("/") || postId.includes("..") || postId.includes("?")) return null;
  return { author, postId };
}

/** Path segment for a tag-channel. Reject empty, path-like, or oversized labels. */
export function normalizeTagLabel(raw: string): string | null {
  const label = raw.trim();
  if (label.length === 0 || label.length > TAG_LABEL_MAX_CHARS) return null;
  if (label.includes("/") || label.includes("\\") || label.includes("..")) return null;
  if (label.includes("?") || label.includes("#") || label.includes("&")) return null;
  if (!TAG_LABEL_RE.test(label)) return null;
  return label;
}

export function encodeTagPath(label: string): string {
  return encodeURIComponent(label);
}

export function isPubkyAuthor(value: string): boolean {
  return isValidPubky(value);
}
