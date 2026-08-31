import { getCohortKey } from "./cohort";

export type AssignmentBucket = "control" | "candidate";

export type Assignment = {
  bucket: AssignmentBucket;
};

export const CONTROL_ASSIGNMENT: Assignment = { bucket: "control" };

function experimentId(): string | undefined {
  const value = process.env.NEXT_PUBLIC_VIBEWARE_EXPERIMENT_ID;
  return value && value.length > 0 ? value : undefined;
}

function ingestUrl(): string | undefined {
  const value = process.env.NEXT_PUBLIC_VIBEWARE_INGEST_URL;
  return value && value.length > 0 ? value : undefined;
}

function ingestToken(): string | undefined {
  const value = process.env.NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN;
  return value && value.length > 0 ? value : undefined;
}

export function assignmentUrlFromIngest(
  ingest: string,
  id: string,
  cohortKey: string,
): string | undefined {
  const trimmed = ingest.trim();
  const match = /^(.*)\/v1\/evidence\/?$/.exec(trimmed);
  if (!match) return undefined;
  const base = match[1];
  if (!base) return undefined;
  const encodedId = encodeURIComponent(id);
  const encodedKey = encodeURIComponent(cohortKey);
  return `${base}/v1/experiments/${encodedId}/assignment?cohort_key=${encodedKey}`;
}

function parseAssignment(body: unknown): Assignment | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return undefined;
  const bucket = (body as { bucket?: unknown }).bucket;
  if (bucket === "control" || bucket === "candidate") {
    return { bucket };
  }
  return undefined;
}

export async function fetchAssignment(): Promise<Assignment> {
  try {
    const id = experimentId();
    if (!id) return CONTROL_ASSIGNMENT;
    const url = ingestUrl();
    const token = ingestToken();
    if (!url || !token) return CONTROL_ASSIGNMENT;
    const cohortKey = await getCohortKey();
    const dest = assignmentUrlFromIngest(url, id, cohortKey);
    if (!dest) return CONTROL_ASSIGNMENT;
    const response = await fetch(dest, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return CONTROL_ASSIGNMENT;
    const parsed = parseAssignment(await response.json());
    return parsed ?? CONTROL_ASSIGNMENT;
  } catch {
    return CONTROL_ASSIGNMENT;
  }
}
