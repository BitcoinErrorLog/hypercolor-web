/**
 * Window-hook names registered only when the e2e harness is compiled in.
 * Derived by scanning `src/` + `app/` for assignments so static-preview and
 * tests share one list that cannot silently miss a new hook file.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_ASSIGN_RE =
  /(?:window\.)?__(?:hypercolor[A-Za-z0-9]+|vibewareSink)\s*=/g;
const HOOK_NAME_RE = /__(?:hypercolor[A-Za-z0-9]+|vibewareSink)/g;
const EXCLUDE = new Set(["__hypercolorLiveSession"]);
const SOURCE_ROOTS = ["src", "app"];
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/**
 * @param {string} dir
 * @param {(full: string) => void} visit
 */
function walkSourceFiles(dir, visit) {
  if (!existsSync(dir)) return;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkSourceFiles(full, visit);
    } else if (SOURCE_EXTS.has(path.extname(name))) {
      visit(full);
    }
  }
}

/**
 * Source files that assign a harness window hook.
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function listHarnessHookSourceFiles(repoRoot) {
  const found = new Set();
  for (const root of SOURCE_ROOTS) {
    walkSourceFiles(path.join(repoRoot, root), (full) => {
      let text;
      try {
        text = readFileSync(full, "utf8");
      } catch {
        return;
      }
      HOOK_ASSIGN_RE.lastIndex = 0;
      if (HOOK_ASSIGN_RE.test(text)) {
        found.add(path.relative(repoRoot, full).split(path.sep).join("/"));
      }
    });
  }
  return [...found].sort();
}

/** @deprecated Prefer listHarnessHookSourceFiles(repoRoot); kept as a snapshot for type consumers. */
export const HARNESS_HOOK_SOURCE_FILES = listHarnessHookSourceFiles(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
);

/**
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function listE2eHarnessHookSymbols(repoRoot) {
  const found = new Set();
  for (const rel of listHarnessHookSourceFiles(repoRoot)) {
    const file = path.join(repoRoot, rel);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(HOOK_NAME_RE)) {
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
 * compare / comment, never as `.__hypercolorFoo=` / `__vibewareSink=`.
 *
 * @param {string} source
 * @param {string} symbol
 * @returns {"absent" | "live" | "inert"}
 */
export function classifyHarnessHookInSource(source, symbol) {
  if (!source.includes(symbol)) return "absent";
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const live = new RegExp(
    String.raw`(?:\.|\[)?(?:${escaped}|["']${escaped}["'])\s*=`,
  );
  if (live.test(source) || source.includes(`${symbol}=`)) return "live";
  return "inert";
}

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

function main(argv) {
  const cmd = argv[0];
  if (cmd === "scan") {
    const exportRoot = argv[1];
    if (!exportRoot) {
      console.error("usage: e2e-harness-symbols.mjs scan <exportRoot>");
      process.exit(1);
    }
    const symbols = listE2eHarnessHookSymbols(REPO_ROOT);
    const hits = findE2eHarnessHookSymbols(exportRoot, symbols).map((hit) => {
      const source = readFileSync(hit.file, "utf8");
      return {
        file: hit.file,
        symbol: hit.symbol,
        kind: classifyHarnessHookInSource(source, hit.symbol),
        gated: /NEXT_PUBLIC_E2E_HARNESS|__HYPERCOLOR_E2E_HARNESS__/.test(source),
      };
    });
    process.stdout.write(JSON.stringify({ symbols, hits }));
    return;
  }
  console.error("usage: e2e-harness-symbols.mjs scan <exportRoot>");
  process.exit(1);
}

const isMain =
  process.argv[1] !== undefined &&
  path.normalize(SCRIPT_PATH) === path.normalize(path.resolve(process.argv[1]));

if (isMain) {
  main(process.argv.slice(2));
}
