/**
 * Browser entry for the P0 evidence contract.
 * Re-exports scripts/vibeware-evidence.mjs so the collector cannot
 * keep a weaker hand copy of validateEvidencePayload.
 */
export {
  BANNED_KEY_RE,
  EVIDENCE_FIELD_VALUES,
  EVIDENCE_PAYLOAD_FIELDS,
  EVIDENCE_ROUTES,
  MAX_PAYLOAD_BYTES,
  V1_EVIDENCE_ALLOWLIST,
  validateEvidencePayload,
} from "../../../scripts/vibeware-evidence.mjs";
