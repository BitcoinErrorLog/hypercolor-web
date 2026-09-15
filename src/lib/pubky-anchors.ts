export type PubkyAnchorParts = {
  head: string;
  mid: string;
  tail: string;
};

const ANCHOR_CHARS = 8;

export function pubkyAnchorParts(pubky: string): PubkyAnchorParts {
  if (pubky.length <= ANCHOR_CHARS * 2) {
    return { head: pubky, mid: "", tail: "" };
  }
  return {
    head: pubky.slice(0, ANCHOR_CHARS),
    mid: pubky.slice(ANCHOR_CHARS, -ANCHOR_CHARS),
    tail: pubky.slice(-ANCHOR_CHARS),
  };
}
