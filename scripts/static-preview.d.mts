export const E2E_HARNESS_MARKER: string;
export const BAD_URL_ENCODING: unique symbol;

export function matchRewrite(
  pathname: string,
  rewrites: { source: string; destination: string }[],
): string | null;
export function loadVercelRewrites(
  repoRoot?: string,
): { source: string; destination: string }[];
export function isE2eHarnessExport(root: string): boolean;
export function harnessHookSymbolsInExport(root: string): string[];
export function resolveOutFile(
  root: string,
  urlPath: string,
): string | null | typeof BAD_URL_ENCODING;
export function startStaticPreview(options: {
  root: string;
  port?: number;
  host?: string;
  rewrites?: { source: string; destination: string }[];
  allowE2eHarness?: boolean;
}): Promise<{
  url: string;
  port: number;
  host: string;
  close: () => Promise<void>;
}>;
