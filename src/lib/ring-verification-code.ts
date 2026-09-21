/**
 * First 6 characters of `ch`, grouped `XXX-XXX` — the same code Pubky Ring
 * shows before the user approves.
 */
export function formatRingVerificationCode(ch: string): string {
  const chars = ch.slice(0, 6);
  if (chars.length < 6) return chars;
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
}
