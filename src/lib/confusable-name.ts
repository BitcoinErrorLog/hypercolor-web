/**
 * Mixed-script / lookalike detection for Nexus usernames.
 *
 * Identifier characters are grouped into script families. Common and
 * Inherited marks (digits, punctuation, combining accents) do not count.
 * CJK scripts are one family so ordinary Japanese/Korean names do not warn.
 * A name is lookalike when it mixes families, or when its families are
 * disjoint from the typed query (Latin "ada" vs Cyrillic "ада").
 */

export type IdentifierScriptFamily =
  | "latin"
  | "cyrillic"
  | "greek"
  | "armenian"
  | "hebrew"
  | "arabic"
  | "indic"
  | "thai"
  | "georgian"
  | "ethiopic"
  | "cjk"
  | "other";

function isLatin(code: number): boolean {
  if (code >= 0x0041 && code <= 0x005a) return true;
  if (code >= 0x0061 && code <= 0x007a) return true;
  if (code >= 0x00c0 && code <= 0x00d6) return true;
  if (code >= 0x00d8 && code <= 0x00f6) return true;
  if (code >= 0x00f8 && code <= 0x024f) return true;
  if (code >= 0x1e00 && code <= 0x1eff) return true;
  if (code >= 0x2c60 && code <= 0x2c7f) return true;
  if (code >= 0xa720 && code <= 0xa7ff) return true;
  if (code >= 0xab30 && code <= 0xab6f) return true;
  return false;
}

function isCyrillic(code: number): boolean {
  return (
    (code >= 0x0400 && code <= 0x04ff) ||
    (code >= 0x0500 && code <= 0x052f) ||
    (code >= 0x2de0 && code <= 0x2dff) ||
    (code >= 0xa640 && code <= 0xa69f)
  );
}

function isGreek(code: number): boolean {
  return (code >= 0x0370 && code <= 0x03ff) || (code >= 0x1f00 && code <= 0x1fff);
}

function isCombiningMark(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}

export function identifierScriptFamily(code: number): IdentifierScriptFamily | null {
  if (isCombiningMark(code)) return null;
  if (isLatin(code)) return "latin";
  if (isCyrillic(code)) return "cyrillic";
  if (isGreek(code)) return "greek";
  if (code >= 0x0530 && code <= 0x058f) return "armenian";
  if (code >= 0x0590 && code <= 0x05ff) return "hebrew";
  if (
    (code >= 0x0600 && code <= 0x06ff) ||
    (code >= 0x0750 && code <= 0x077f) ||
    (code >= 0x08a0 && code <= 0x08ff) ||
    (code >= 0xfb50 && code <= 0xfdff) ||
    (code >= 0xfe70 && code <= 0xfeff)
  ) {
    return "arabic";
  }
  if (
    (code >= 0x0900 && code <= 0x097f) ||
    (code >= 0x0980 && code <= 0x09ff) ||
    (code >= 0x0a00 && code <= 0x0a7f) ||
    (code >= 0x0a80 && code <= 0x0aff)
  ) {
    return "indic";
  }
  if (code >= 0x0e00 && code <= 0x0e7f) return "thai";
  if (code >= 0x10a0 && code <= 0x10ff) return "georgian";
  if (code >= 0x1200 && code <= 0x137f) return "ethiopic";
  if (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x3040 && code <= 0x309f) ||
    (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0x3130 && code <= 0x318f) ||
    (code >= 0x31f0 && code <= 0x31ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af)
  ) {
    return "cjk";
  }
  if (/\p{L}/u.test(String.fromCodePoint(code))) return "other";
  return null;
}

export function identifierScriptFamilies(value: string): Set<IdentifierScriptFamily> {
  const out = new Set<IdentifierScriptFamily>();
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    const family = identifierScriptFamily(code);
    if (family) out.add(family);
  }
  return out;
}

export function nameHasLookalikeCharacters(name: string, query?: string): boolean {
  const nameScripts = identifierScriptFamilies(name);
  if (nameScripts.size > 1) return true;
  if (query === undefined) return false;
  const queryScripts = identifierScriptFamilies(query);
  if (nameScripts.size === 0 || queryScripts.size === 0) return false;
  for (const script of nameScripts) {
    if (queryScripts.has(script)) return false;
  }
  return true;
}
