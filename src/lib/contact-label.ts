import { sanitizeDisplayName } from "@/lib/display-name";
import { shortPubky } from "@/lib/format";

const NICKNAME_MAX = 40;

export function normalizeNickname(raw: string): string | null {
  const trimmed = raw.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!trimmed) return null;
  const clipped = [...trimmed].slice(0, NICKNAME_MAX).join("");
  if (/^[a-z0-9]{52}$/.test(trimmed)) return null;
  return clipped;
}

export function contactPrimaryLabel(input: {
  nickname?: string | null;
  displayName?: string | null;
  pubky: string;
}): { primary: string; secondary: string | null } {
  const nick = input.nickname ? sanitizeDisplayName(input.nickname) : "";
  const real = input.displayName ? sanitizeDisplayName(input.displayName) : "";
  const short = shortPubky(input.pubky);
  if (nick) {
    return { primary: nick, secondary: real || short };
  }
  if (real) {
    return { primary: real, secondary: short };
  }
  return { primary: short, secondary: null };
}

export function dmThreadKey(conversationId: string): string {
  return `dm:${conversationId}`;
}

export function groupThreadKey(channelId: string): string {
  return `group:${channelId}`;
}
