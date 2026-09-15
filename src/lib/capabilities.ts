/**
 * Client-side grant check for the Hypercolor owner tree.
 *
 * The wasm cookie-resume only guarantees `/pub/paykit/` rw. A paykit-only
 * legacy grant must land in needs-enable, not a half-working session
 * (design §1c). Scope-cover rules match the binding:
 * `scope == target || (scope.endsWith("/") && target.startsWith(scope))`.
 */

export const HYPERCOLOR_WRITE_SCOPE = "/pub/hypercolor.app/v1/";

export interface ParsedCapability {
  scope: string;
  read: boolean;
  write: boolean;
}

export function parseCapabilitySpec(spec: string): ParsedCapability | null {
  const lastColon = spec.lastIndexOf(":");
  if (lastColon <= 0) return null;
  const scope = spec.slice(0, lastColon);
  const actions = spec.slice(lastColon + 1);
  if (!scope.startsWith("/")) return null;
  if (!/^[rw]+$/.test(actions)) return null;
  return {
    scope,
    read: actions.includes("r"),
    write: actions.includes("w"),
  };
}

export function scopeCovers(scope: string, target: string): boolean {
  return scope === target || (scope.endsWith("/") && target.startsWith(scope));
}

export function capabilitiesCoverHypercolorRw(specs: readonly string[]): boolean {
  return specs.some((spec) => {
    const cap = parseCapabilitySpec(spec);
    return (
      cap !== null &&
      scopeCovers(cap.scope, HYPERCOLOR_WRITE_SCOPE) &&
      cap.read &&
      cap.write
    );
  });
}

/**
 * SessionInfo is postcard-encoded; capability entries are UTF-8
 * `"<scope>:<actions>"` strings inside that blob. Scanning the decoded
 * export is enough to apply the extra Hypercolor rw check.
 */
export function extractCapabilitySpecsFromExport(exported: string): string[] {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(exported), (c) => c.charCodeAt(0));
  } catch {
    return [];
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return text.match(/\/[A-Za-z0-9._~/=-]*:[rw]+/g) ?? [];
}
