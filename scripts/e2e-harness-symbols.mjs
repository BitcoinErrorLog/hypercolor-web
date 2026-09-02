/**
 * Window-hook names registered only when the e2e harness is compiled in.
 * Enumerated from source so static-preview and tests share one list.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const HARNESS_HOOK_SOURCE_FILES = [
  "src/components/backup-leave-guard.tsx",
  "src/components/settings-page.tsx",
];

const HOOK_RE = /__hypercolor[A-Za-z0-9]+/g;
const EXCLUDE = new Set(["__hypercolorLiveSession"]);

/**
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function listE2eHarnessHookSymbols(repoRoot) {
  const found = new Set();
  for (const rel of HARNESS_HOOK_SOURCE_FILES) {
    const file = path.join(repoRoot, rel);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(HOOK_RE)) {
      if (!EXCLUDE.has(match[0])) found.add(match[0]);
    }
  }
  return [...found].sort();
}

/**
 * @param {string} dir
 * @param {string[]} acc
 * @returns {string[]}
 */
function walkJsFiles(dir, acc) {
  if (!existsSync(dir)) return acc;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of names) {
    if (name.startsWith("._")) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkJsFiles(full, acc);
    } else if (name.endsWith(".js") || name.endsWith(".html")) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * @param {string} exportRoot
 * @param {string[]} symbols
 * @returns {{ file: string, symbol: string }[]}
 */
export function findE2eHarnessHookSymbols(exportRoot, symbols) {
  const hits = [];
  const files = walkJsFiles(path.resolve(exportRoot), []);
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const symbol of symbols) {
      if (text.includes(symbol)) hits.push({ file, symbol });
    }
  }
  return hits;
}

/**
 * A hook registration is live when the compiled chunk assigns the window
 * property. An inert leftover is the identifier appearing only as a string
 * compare / comment, never as `.__hypercolorFoo=`.
 *
 * @param {string} source
 * @param {string} symbol
 * @returns {"absent" | "live" | "inert"}
 */
export function classifyHarnessHookInSource(source, symbol) {
  if (!source.includes(symbol)) return "absent";
  const live = new RegExp(
    String.raw`(?:\.|\[)(?:${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|["']${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'])\s*=`,
  );
  if (live.test(source) || source.includes(`${symbol}=`)) return "live";
  return "inert";
}
