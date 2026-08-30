export const V1_EVIDENCE_ALLOWLIST: readonly string[];
export const EVIDENCE_PAYLOAD_FIELDS: Readonly<Record<string, readonly string[]>>;
export const MAX_PAYLOAD_BYTES: number;
export function validateEvidencePayload(
  eventType: unknown,
  payload: unknown,
): { ok: true } | { ok: false; reason: string; key?: string; keys?: string[] };
export function deepEqual(a: unknown, b: unknown): boolean;
export function payloadFieldsFromDoc(doc: unknown): Record<string, string[]>;
export function assertEvidenceContract(doc: unknown, allowlist: unknown): void;
