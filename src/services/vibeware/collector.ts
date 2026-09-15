import { getCohortKey } from "./cohort";
import { validateEvidencePayload } from "./schema";

export type EvidenceEvent = {
  type: string;
  actor: string;
  privacy: { contains_user_content: false };
  payload: Record<string, unknown>;
};

export const MEMORY_SINK_MAX = 256;

const memorySink: EvidenceEvent[] = [];
let listening = false;

declare global {
  interface Window {
    __vibewareSink?: EvidenceEvent[];
  }
}

function ingestUrl(): string | undefined {
  const value = process.env.NEXT_PUBLIC_VIBEWARE_INGEST_URL;
  return value && value.length > 0 ? value : undefined;
}

function ingestToken(): string | undefined {
  const value = process.env.NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN;
  return value && value.length > 0 ? value : undefined;
}

function attachHarnessSink(): void {
  if (typeof window === "undefined") return;
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") return;
  window.__vibewareSink = memorySink;
}

function pushMemorySink(event: EvidenceEvent): void {
  memorySink.push(event);
  if (memorySink.length > MEMORY_SINK_MAX) {
    memorySink.splice(0, memorySink.length - MEMORY_SINK_MAX);
  }
}

export function getMemorySink(): readonly EvidenceEvent[] {
  return memorySink;
}

export function resetMemorySink(): void {
  memorySink.length = 0;
}

export function ensureVibewareListener(): void {
  if (listening) return;
  listening = true;
  attachHarnessSink();
  if (typeof window === "undefined") return;
  window.addEventListener("hypercolor-vibeware", (event) => {
    const detail = (event as CustomEvent).detail;
    if (!detail || typeof detail !== "object") return;
    const rec = detail as { type?: unknown; payload?: unknown };
    void emit(rec.type, rec.payload);
  });
}

export async function emit(type: unknown, payload: unknown): Promise<void> {
  try {
    ensureVibewareListener();
    const check = validateEvidencePayload(type, payload);
    if (!check.ok) return;
    if (typeof type !== "string" || payload === null || typeof payload !== "object") return;
    const actor = await getCohortKey();
    const event: EvidenceEvent = {
      type,
      actor,
      privacy: { contains_user_content: false },
      payload: payload as Record<string, unknown>,
    };
    const url = ingestUrl();
    if (url) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const token = ingestToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      try {
        await fetch(url, { method: "POST", headers, body: JSON.stringify(event) });
      } catch {
        return;
      }
      return;
    }
    pushMemorySink(event);
    attachHarnessSink();
  } catch {
    return;
  }
}

if (typeof window !== "undefined") {
  ensureVibewareListener();
}
