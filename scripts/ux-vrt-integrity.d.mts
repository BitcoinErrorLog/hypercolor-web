export const IDENTITY_THRESHOLD: number;
export const IDENTITY_ALLOWLIST: Map<string, string>;
export const MIN_BASELINE_BYTES: number;
export const MIN_DISTINCT_COLORS: number;
export function distinctColors(
  image: { data: Uint8Array; width: number; height: number },
  limit?: number,
): number;
export function findBlankPngs(files: string[]): Promise<string[]>;
export function listPngs(dir: string): string[];
export function readPng(path: string): Promise<{
  data: Uint8Array;
  width: number;
  height: number;
}>;
export function cropToCommon(
  a: { data: Uint8Array; width: number; height: number },
  b: { data: Uint8Array; width: number; height: number },
): {
  a: Uint8Array;
  b: Uint8Array;
  width: number;
  height: number;
};
export function compareImages(
  a: { data: Uint8Array; width: number; height: number },
  b: { data: Uint8Array; width: number; height: number },
): {
  identity: number;
  commonPixels: number;
  sizeMismatch: boolean;
};
export function findNearDuplicatePngs(files: string[], allowlist?: Map<string, string>): Promise<string[]>;
