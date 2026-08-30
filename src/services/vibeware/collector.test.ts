import { afterEach, describe, expect, it } from "vitest";
import {
  EVIDENCE_PAYLOAD_FIELDS as NODE_FIELDS,
  V1_EVIDENCE_ALLOWLIST as NODE_ALLOWLIST,
  validateEvidencePayload as nodeValidate,
} from "../../../scripts/vibeware-evidence.mjs";
import { getCohortKey } from "./cohort";
import { emit, getMemorySink, resetMemorySink } from "./collector";
import {
  EVIDENCE_PAYLOAD_FIELDS,
  V1_EVIDENCE_ALLOWLIST,
  validateEvidencePayload,
} from "./schema";

const FIXTURE_PUBKY = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

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
    await emit("app.route.viewed", { route: "chats", from_route: null });
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
    expect(nodeValidate("app.thread.send_settled", {
      channel: "dm",
      outcome: "sent",
      kind: "text",
      body: "hi",
    }).ok).toBe(false);
  });

  it("does not widen the P0 allowlist or field tables", () => {
    expect([...V1_EVIDENCE_ALLOWLIST]).toEqual([...NODE_ALLOWLIST]);
    expect(EVIDENCE_PAYLOAD_FIELDS).toEqual(NODE_FIELDS);
  });
});
