/** Strip FTS5 operators so user input cannot inject MATCH syntax. */
export function sanitizeFtsQuery(raw: string): string {
  const tokens = raw
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9_\s]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .slice(0, 8);
  return tokens.map((token) => `"${token}"`).join(" AND ");
}

export function likePattern(raw: string): string | null {
  const needle = raw
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 80);
  if (!needle) return null;
  return `%${needle}%`;
}

export function normalizeSearchBody(body: string): string {
  return body.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}
