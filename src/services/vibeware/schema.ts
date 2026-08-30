/**
 * Browser-safe copy of scripts/vibeware-evidence.mjs. Collector tests
 * assert these tables deep-equal the P0 module so this list cannot widen.
 */
export const V1_EVIDENCE_ALLOWLIST = [
  "app.route.viewed",
  "app.onboarding.state",
  "app.onboarding.abandoned",
  "app.chat.empty_state",
  "app.thread.send_settled",
  "app.request.decision",
  "app.backup.export_outcome",
  "app.error.coarse",
  "app.pwa.installed",
] as const;

export const EVIDENCE_PAYLOAD_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "app.route.viewed": ["route", "from_route"],
  "app.onboarding.state": ["state"],
  "app.onboarding.abandoned": ["step"],
  "app.chat.empty_state": ["kind"],
  "app.thread.send_settled": ["channel", "outcome", "kind"],
  "app.request.decision": ["kind", "decision"],
  "app.backup.export_outcome": ["outcome"],
  "app.error.coarse": ["code", "surface"],
  "app.pwa.installed": ["outcome"],
};

export const MAX_PAYLOAD_BYTES = 256;

const BANNED_KEY_RE =
  /(body|rawjson|raw_json|recovery|token|pubky|secret|payment|attachment)/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectKeys(value: unknown, acc: string[] = []): string[] {
  if (!isPlainObject(value)) return acc;
  for (const [key, child] of Object.entries(value)) {
    acc.push(key);
    collectKeys(child, acc);
  }
  return acc;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function validateEvidencePayload(
  eventType: unknown,
  payload: unknown,
): { ok: true } | { ok: false; reason: string; key?: string; keys?: string[] } {
  if (typeof eventType !== "string" || !Object.hasOwn(EVIDENCE_PAYLOAD_FIELDS, eventType)) {
    return { ok: false, reason: "unknown_event" };
  }
  if (!isPlainObject(payload)) {
    return { ok: false, reason: "payload_not_object" };
  }
  const keys = collectKeys(payload);
  for (const key of keys) {
    if (BANNED_KEY_RE.test(key)) {
      return { ok: false, reason: "banned_key", key };
    }
  }
  if (Object.hasOwn(payload, "contains_user_content") && payload.contains_user_content !== false) {
    return { ok: false, reason: "contains_user_content" };
  }
  const allowed = EVIDENCE_PAYLOAD_FIELDS[eventType];
  const topKeys = Object.keys(payload);
  const extra = topKeys.filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    return { ok: false, reason: "extra_keys", keys: extra };
  }
  const missing = allowed.filter((key) => !Object.hasOwn(payload, key));
  if (missing.length > 0) {
    return { ok: false, reason: "missing_keys", keys: missing };
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(payload);
  } catch {
    return { ok: false, reason: "unserializable" };
  }
  if (utf8ByteLength(encoded) > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: "payload_too_large" };
  }
  return { ok: true };
}
