export const HARNESS_HOOK_SOURCE_FILES: readonly string[];
export function listHarnessHookSourceFiles(repoRoot: string): string[];
export function listE2eHarnessHookSymbols(repoRoot: string): string[];
export function findE2eHarnessHookSymbols(
  exportRoot: string,
  symbols: string[],
): { file: string; symbol: string }[];
export function classifyHarnessHookInSource(
  source: string,
  symbol: string,
): "absent" | "live" | "inert";
