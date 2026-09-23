/**
 * P0 evidence payload contract. The collector (P1) must call
 * validateEvidencePayload before emitting. Extra keys, unknown events,
 * and secret-shaped field names fail closed.
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
];

export const EVIDENCE_PAYLOAD_FIELDS = {
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

export const EVIDENCE_ROUTES = [
  "welcome",
  "enable",
  "chats",
  "chat",
  "channels",
  "channel",
  "contacts",
  "contact",
  "requests",
  "profile",
  "settings",
];

export const EVIDENCE_FIELD_VALUES = {
  "app.route.viewed": {
    route: EVIDENCE_ROUTES,
    from_route: [...EVIDENCE_ROUTES, "none"],
  },
  "app.onboarding.state": {
    state: ["no-identity", "needs-enable", "session-offline", "live"],
  },
  "app.onboarding.abandoned": {
    step: ["welcome", "enable"],
  },
  "app.chat.empty_state": {
    kind: ["dms", "groups", "requests"],
  },
  "app.thread.send_settled": {
    channel: ["dm", "group"],
    outcome: ["sent", "failed", "queued"],
    kind: ["text", "attachment"],
  },
  "app.request.decision": {
    kind: ["dm", "group-invite"],
    decision: ["accept", "decline"],
  },
  "app.backup.export_outcome": {
    outcome: ["shown", "confirmed", "cancelled"],
  },
  "app.error.coarse": {
    code: [
      "network",
      "auth",
      "protocol",
      "consumed",
      "validation",
      "unavailable",
      "too-large",
      "not-found",
      "unsupported-target",
      "decrypt-failed",
    ],
    surface: [
      "hc-chats-ui",
      "hc-thread-ui",
      "hc-onboarding-ui",
      "chats",
      "thread",
      "onboarding",
      "settings",
      "requests",
      "pwa",
      "groups",
      "contacts",
    ],
  },
  "app.pwa.installed": {
    outcome: ["accepted", "dismissed"],
  },
};

export const BANNED_KEY_RE =
  /(body|rawjson|raw_json|recovery|token|pubky|secret|payment|attachment|seed|credential|password|url)/i;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectKeys(value, acc = []) {
  if (!isPlainObject(value)) return acc;
  for (const [key, child] of Object.entries(value)) {
    acc.push(key);
    collectKeys(child, acc);
  }
  return acc;
}

export function validateEvidencePayload(eventType, payload) {
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
  const enums = EVIDENCE_FIELD_VALUES[eventType];
  for (const key of allowed) {
    const value = payload[key];
    if (value !== null && typeof value === "object") {
      return { ok: false, reason: "nested_value", key };
    }
    if (typeof value !== "string") {
      return { ok: false, reason: "value_not_string", key };
    }
    const allowedValues = enums?.[key];
    if (!allowedValues || !allowedValues.includes(value)) {
      return { ok: false, reason: "invalid_value", key };
    }
  }
  let encoded;
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

function utf8ByteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

export function payloadFieldsFromDoc(doc) {
  const raw = doc?.evidence_payloads;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("vibeware: evidence_payloads must be a mapping");
  }
  const out = {};
  for (const [eventType, spec] of Object.entries(raw)) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      throw new Error(`vibeware: evidence_payloads.${eventType} must be a mapping`);
    }
    const extra = Object.keys(spec).filter((key) => key !== "fields");
    if (extra.length > 0) {
      throw new Error(
        `vibeware: evidence_payloads.${eventType} has extra keys: ${extra.join(", ")}`,
      );
    }
    const fields = spec.fields;
    if (!Array.isArray(fields) || fields.some((item) => typeof item !== "string")) {
      throw new Error(`vibeware: evidence_payloads.${eventType}.fields must be a list of strings`);
    }
    out[eventType] = fields.map((item) => item.trim()).filter(Boolean);
  }
  return out;
}

export function assertEvidenceContract(doc, allowlist) {
  if (!deepEqual(allowlist, V1_EVIDENCE_ALLOWLIST)) {
    throw new Error("vibeware: evidence_allowlist must deep-equal the frozen v1 list");
  }
  const fromDoc = payloadFieldsFromDoc(doc);
  if (!deepEqual(Object.keys(fromDoc), V1_EVIDENCE_ALLOWLIST)) {
    throw new Error("vibeware: evidence_payloads keys must deep-equal evidence_allowlist");
  }
  for (const eventType of V1_EVIDENCE_ALLOWLIST) {
    if (!deepEqual(fromDoc[eventType], EVIDENCE_PAYLOAD_FIELDS[eventType])) {
      throw new Error(`vibeware: evidence_payloads.${eventType}.fields do not match the P0 schema`);
    }
    const enums = EVIDENCE_FIELD_VALUES[eventType];
    if (!enums || !deepEqual(Object.keys(enums), EVIDENCE_PAYLOAD_FIELDS[eventType])) {
      throw new Error(`vibeware: EVIDENCE_FIELD_VALUES.${eventType} fields do not match the P0 schema`);
    }
  }
  if (doc.max_payload_bytes !== MAX_PAYLOAD_BYTES) {
    throw new Error(`vibeware: max_payload_bytes must be ${MAX_PAYLOAD_BYTES}`);
  }
  if (doc.privacy?.contains_user_content !== false) {
    throw new Error("vibeware: privacy.contains_user_content must be false");
  }
}
