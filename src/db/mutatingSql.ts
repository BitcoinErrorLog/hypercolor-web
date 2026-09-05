/** True when the statement would change the on-disk / in-memory database. */
export function isMutatingSql(sql: string): boolean {
  const trimmed = sql.trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(trimmed)) return false;
  if (/^SELECT\b/i.test(trimmed)) return false;
  if (/^PRAGMA\s+(?!user_version\s*=)/i.test(trimmed)) return false;
  return true;
}
