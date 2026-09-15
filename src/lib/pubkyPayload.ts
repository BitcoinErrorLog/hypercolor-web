import type { PubkyKey } from "@/types";
import { isValidPubky, parsePubky, PUBKY_ID_LENGTH } from "@/utils/pubkyId";

const Z32 = "ybndrfg8ejkmcpqxot1uwisza345h769";
const Z32_RUN = new RegExp(`[${Z32}]{${PUBKY_ID_LENGTH}}`, "i");
const CONCAT_PUBKY = new RegExp(
  `^pubky(?::\\/\\/|:)?([${Z32}]{${PUBKY_ID_LENGTH}})(?:[/?#].*)?$`,
  "i",
);

export function canonicalPubkyUri(pubky: string): string {
  return `pubky://${pubky.toLowerCase()}`;
}

function firstValidZ32(text: string): PubkyKey | null {
  const match = text.toLowerCase().match(Z32_RUN);
  if (!match?.[0] || !isValidPubky(match[0])) return null;
  return match[0];
}

function parseHttpProfileUrl(raw: string): PubkyKey | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (host !== "pubky.app") return null;
  const parts = [
    ...url.pathname.split("/").filter(Boolean),
    ...url.searchParams.values(),
    url.hash.replace(/^#/, ""),
  ];
  for (const part of parts) {
    let decoded = part;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      decoded = part;
    }
    const asKey = parsePubky(decoded) ?? firstValidZ32(decoded);
    if (asKey) return asKey;
  }
  return null;
}

/**
 * Accepts the identity payloads a user can paste or scan:
 * `pubky://<z32>`, `pubky<z32>`, bare 52-char z-base-32, and
 * `https://pubky.app/…` profile URLs. Invalid charset (0, 2, l, v) fails.
 */
export function parsePubkyPayload(raw: string): PubkyKey | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const direct = parsePubky(trimmed);
  if (direct) return direct;

  const concat = trimmed.match(CONCAT_PUBKY);
  if (concat?.[1] && isValidPubky(concat[1].toLowerCase())) {
    return concat[1].toLowerCase();
  }

  const fromUrl = parseHttpProfileUrl(trimmed);
  if (fromUrl) return fromUrl;

  return null;
}
