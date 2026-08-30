import { afterEach, describe, expect, it } from "vitest";
import {
  BANNED_KEY_RE as NODE_BANNED_KEY_RE,
  EVIDENCE_FIELD_VALUES as NODE_FIELD_VALUES,
  EVIDENCE_PAYLOAD_FIELDS as NODE_FIELDS,
  MAX_PAYLOAD_BYTES as NODE_MAX_PAYLOAD_BYTES,
  V1_EVIDENCE_ALLOWLIST as NODE_ALLOWLIST,
  validateEvidencePayload as nodeValidate,
} from "../../../scripts/vibeware-evidence.mjs";
import { getCohortKey } from "./cohort";
import { emit, getMemorySink, MEMORY_SINK_MAX, resetMemorySink } from "./collector";
import {
  BANNED_KEY_RE,
  EVIDENCE_FIELD_VALUES,
  EVIDENCE_PAYLOAD_FIELDS,
  MAX_PAYLOAD_BYTES,
  V1_EVIDENCE_ALLOWLIST,
  validateEvidencePayload,
} from "./schema";

const FIXTURE_PUBKY = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

type Verdict = { ok: true } | { ok: false; reason: string };

const EVIDENCE_PARITY_FIXTURES: Array<{
  name: string;
  type: unknown;
  payload: unknown;
  expected: Verdict;
}> = [
  {
    name: "valid route viewed",
    type: "app.route.viewed",
    payload: { route: "chats", from_route: "none" },
    expected: { ok: true },
  },
  {
    name: "valid empty state",
    type: "app.chat.empty_state",
    payload: { kind: "dms" },
    expected: { ok: true },
  },
  {
    name: "valid send settled",
    type: "app.thread.send_settled",
    payload: { channel: "dm", outcome: "sent", kind: "text" },
    expected: { ok: true },
  },
  {
    name: "secret message as route",
    type: "app.route.viewed",
    payload: { route: "secret message", from_route: "none" },
    expected: { ok: false, reason: "invalid_value" },
  },
  {
    name: "pubky-shaped route",
    type: "app.route.viewed",
    payload: { route: FIXTURE_PUBKY, from_route: "none" },
    expected: { ok: false, reason: "invalid_value" },
  },
  {
    name: "null from_route",
    type: "app.route.viewed",
    payload: { route: "chats", from_route: null },
    expected: { ok: false, reason: "value_not_string" },
  },
  {
    name: "number value",
    type: "app.pwa.installed",
    payload: { outcome: 1 },
    expected: { ok: false, reason: "value_not_string" },
  },
  {
    name: "nested object value",
    type: "app.chat.empty_state",
    payload: { kind: { leak: "recovery-code-material" } },
    expected: { ok: false, reason: "nested_value" },
  },
  {
    name: "nested array value",
    type: "app.chat.empty_state",
    payload: { kind: ["dms"] },
    expected: { ok: false, reason: "nested_value" },
  },
  {
    name: "planted body key",
    type: "app.thread.send_settled",
    payload: { channel: "dm", outcome: "sent", kind: "text", body: "hi" },
    expected: { ok: false, reason: "banned_key" },
  },
  {
    name: "seed key",
    type: "app.pwa.installed",
    payload: { outcome: "accepted", seed: "x" },
    expected: { ok: false, reason: "banned_key" },
  },
  {
    name: "credential key",
    type: "app.pwa.installed",
    payload: { outcome: "accepted", credential: "x" },
    expected: { ok: false, reason: "banned_key" },
  },
  {
    name: "password key",
    type: "app.pwa.installed",
    payload: { outcome: "accepted", password: "x" },
    expected: { ok: false, reason: "banned_key" },
  },
  {
    name: "url key",
    type: "app.pwa.installed",
    payload: { outcome: "accepted", url: "https://x" },
    expected: { ok: false, reason: "banned_key" },
  },
  {
    name: "pubky key",
    type: "app.onboarding.state",
    payload: { state: "live", pubky: FIXTURE_PUBKY },
    expected: { ok: false, reason: "banned_key" },
  },
  {
    name: "unknown event",
    type: "app.secret.dump",
    payload: { kind: "x" },
    expected: { ok: false, reason: "unknown_event" },
  },
  {
    name: "payload not object",
    type: "app.pwa.installed",
    payload: "accepted",
    expected: { ok: false, reason: "payload_not_object" },
  },
  {
    name: "extra keys",
    type: "app.pwa.installed",
    payload: { outcome: "accepted", extra: "1" },
    expected: { ok: false, reason: "extra_keys" },
  },
  {
    name: "missing keys",
    type: "app.pwa.installed",
    payload: {},
    expected: { ok: false, reason: "missing_keys" },
  },
  {
    name: "contains_user_content true",
    type: "app.pwa.installed",
    payload: { outcome: "accepted", contains_user_content: true },
    expected: { ok: false, reason: "contains_user_content" },
  },
  {
    name: "oversized kind string",
    type: "app.thread.send_settled",
    payload: { channel: "dm", outcome: "sent", kind: "x".repeat(200) },
    expected: { ok: false, reason: "invalid_value" },
  },
];

function verdictOf(
  result: { ok: true } | { ok: false; reason: string },
): Verdict {
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

function memoryStorage(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

afterEach(() => {
  resetMemorySink();
});

describe("vibeware collector", () => {
  it("persists allowlisted events to the in-memory sink", async () => {
    await emit("app.route.viewed", { route: "chats", from_route: "none" });
    await emit("app.chat.empty_state", { kind: "dms" });
    const types = getMemorySink().map((event) => event.type);
    expect(types).toEqual(["app.route.viewed", "app.chat.empty_state"]);
    expect(getMemorySink().every((event) => event.privacy.contains_user_content === false)).toBe(
      true,
    );
    expect(getMemorySink().every((event) => /^[0-9a-f]{64}$/.test(event.actor))).toBe(true);
  });

  it("drops a planted body field", async () => {
    await emit("app.thread.send_settled", {
      channel: "dm",
      outcome: "sent",
      kind: "text",
      body: "secret-body",
    });
    expect(getMemorySink()).toEqual([]);
  });

  it("drops a pubky field", async () => {
    await emit("app.onboarding.state", { state: "live", pubky: FIXTURE_PUBKY });
    expect(getMemorySink()).toEqual([]);
  });

  it("rejects a secret-message route value", () => {
    const result = validateEvidencePayload("app.route.viewed", {
      route: "secret message",
      from_route: "none",
    });
    expect(result).toEqual({ ok: false, reason: "invalid_value", key: "route" });
  });

  it("rejects nested object values", () => {
    const result = validateEvidencePayload("app.chat.empty_state", {
      kind: { leak: "recovery-code-material" },
    });
    expect(result).toEqual({ ok: false, reason: "nested_value", key: "kind" });
  });

  it("rejects a 52-char pubky-shaped route", () => {
    const result = validateEvidencePayload("app.route.viewed", {
      route: FIXTURE_PUBKY,
      from_route: "none",
    });
    expect(result).toEqual({ ok: false, reason: "invalid_value", key: "route" });
  });

  it("does not land a forged CustomEvent that plants a pubky in route", async () => {
    const detail = { type: "app.route.viewed", payload: { route: FIXTURE_PUBKY, from_route: "none" } };
    await emit(detail.type, detail.payload);
    expect(getMemorySink()).toEqual([]);
    expect(JSON.stringify(getMemorySink())).not.toContain(FIXTURE_PUBKY);
  });

  it("caps the memory sink at MEMORY_SINK_MAX", async () => {
    expect(MEMORY_SINK_MAX).toBe(256);
    for (let i = 0; i < MEMORY_SINK_MAX + 1; i += 1) {
      await emit("app.pwa.installed", { outcome: "accepted" });
    }
    expect(getMemorySink()).toHaveLength(MEMORY_SINK_MAX);
  });

  it("does not throw on unknown or malformed events", async () => {
    await expect(emit("app.secret.dump", { body: "nope" })).resolves.toBeUndefined();
    await expect(emit(null, undefined)).resolves.toBeUndefined();
    await expect(emit("app.pwa.installed", "accepted")).resolves.toBeUndefined();
    expect(getMemorySink()).toEqual([]);
  });

  it("keeps the cohort key at 64 hex and not equal to a fixture pubky", async () => {
    const key = await getCohortKey({
      storage: memoryStorage(),
      origin: "https://hypercolor.app",
    });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toBe(FIXTURE_PUBKY);
    expect(key.includes(FIXTURE_PUBKY)).toBe(false);
  });

  it("rejects a forged body through validateEvidencePayload", () => {
    const forged = validateEvidencePayload("app.thread.send_settled", {
      channel: "dm",
      outcome: "sent",
      kind: "text",
      body: "hi",
    });
    expect(forged.ok).toBe(false);
    expect(
      nodeValidate("app.thread.send_settled", {
        channel: "dm",
        outcome: "sent",
        kind: "text",
        body: "hi",
      }).ok,
    ).toBe(false);
  });

  it("does not widen the P0 allowlist or field tables", () => {
    expect([...V1_EVIDENCE_ALLOWLIST]).toEqual([...NODE_ALLOWLIST]);
    expect(EVIDENCE_PAYLOAD_FIELDS).toEqual(NODE_FIELDS);
    expect(EVIDENCE_FIELD_VALUES).toEqual(NODE_FIELD_VALUES);
    expect(MAX_PAYLOAD_BYTES).toBe(NODE_MAX_PAYLOAD_BYTES);
    expect(MAX_PAYLOAD_BYTES).toBe(256);
    expect(BANNED_KEY_RE.source).toBe(NODE_BANNED_KEY_RE.source);
    expect(BANNED_KEY_RE.flags).toBe(NODE_BANNED_KEY_RE.flags);
    expect(BANNED_KEY_RE.source).toContain("seed|credential|password|url");
  });

  it("matches the P0 validator on a shared fixture table", () => {
    for (const fixture of EVIDENCE_PARITY_FIXTURES) {
      const browser = verdictOf(validateEvidencePayload(fixture.type, fixture.payload));
      const node = verdictOf(nodeValidate(fixture.type, fixture.payload));
      expect(browser, fixture.name).toEqual(fixture.expected);
      expect(node, fixture.name).toEqual(browser);
    }
  });
});
