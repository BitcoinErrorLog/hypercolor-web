import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assignmentUrlFromIngest, CONTROL_ASSIGNMENT, fetchAssignment } from "./assignment";

const ENV_KEYS = [
  "NEXT_PUBLIC_VIBEWARE_EXPERIMENT_ID",
  "NEXT_PUBLIC_VIBEWARE_INGEST_URL",
  "NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN",
] as const;

const savedEnv: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): void {
  for (const key of ENV_KEYS) {
    const next = values[key];
    if (next === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = next;
    }
  }
}

for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
});

const SOURCE = readFileSync(fileURLToPath(new URL("./assignment.ts", import.meta.url)), "utf8");

describe("assignmentUrlFromIngest", () => {
  it("strips /v1/evidence and appends the assignment path", () => {
    expect(
      assignmentUrlFromIngest(
        "https://store.example/v1/evidence",
        "exp_1",
        "ab".repeat(32),
      ),
    ).toBe(`https://store.example/v1/experiments/exp_1/assignment?cohort_key=${"ab".repeat(32)}`);
  });

  it("strips a trailing slash on /v1/evidence", () => {
    expect(
      assignmentUrlFromIngest("https://store.example/v1/evidence/", "exp_1", "cd".repeat(32)),
    ).toBe(`https://store.example/v1/experiments/exp_1/assignment?cohort_key=${"cd".repeat(32)}`);
  });

  it("returns undefined when the ingest path is not /v1/evidence", () => {
    expect(assignmentUrlFromIngest("https://store.example/v1/projection", "exp_1", "ab".repeat(32))).toBeUndefined();
    expect(assignmentUrlFromIngest("https://store.example/v1/evidence/extra", "exp_1", "ab".repeat(32))).toBeUndefined();
  });
});

describe("fetchAssignment", () => {
  it("does not fetch and returns control when the experiment id is unset", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    setEnv({
      NEXT_PUBLIC_VIBEWARE_EXPERIMENT_ID: undefined,
      NEXT_PUBLIC_VIBEWARE_INGEST_URL: "https://store.example/v1/evidence",
      NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN: "ingest-token",
    });
    await expect(fetchAssignment()).resolves.toEqual(CONTROL_ASSIGNMENT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns control without fetching when ingest url or token is missing", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    setEnv({
      NEXT_PUBLIC_VIBEWARE_EXPERIMENT_ID: "exp_1",
      NEXT_PUBLIC_VIBEWARE_INGEST_URL: undefined,
      NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN: "ingest-token",
    });
    await expect(fetchAssignment()).resolves.toEqual(CONTROL_ASSIGNMENT);
    expect(fetchMock).not.toHaveBeenCalled();

    setEnv({
      NEXT_PUBLIC_VIBEWARE_EXPERIMENT_ID: "exp_1",
      NEXT_PUBLIC_VIBEWARE_INGEST_URL: "https://store.example/v1/evidence",
      NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN: undefined,
    });
    await expect(fetchAssignment()).resolves.toEqual(CONTROL_ASSIGNMENT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GETs assignment with the ingest bearer token and ignores extra JSON keys", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bucket: "candidate",
        experiment_id: "exp_1",
        killed: false,
        extra: "ignored",
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;
    setEnv({
      NEXT_PUBLIC_VIBEWARE_EXPERIMENT_ID: "exp_1",
      NEXT_PUBLIC_VIBEWARE_INGEST_URL: "https://store.example/v1/evidence",
      NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN: "ingest-token",
    });
    await expect(fetchAssignment()).resolves.toEqual({ bucket: "candidate" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(
      /^https:\/\/store\.example\/v1\/experiments\/exp_1\/assignment\?cohort_key=[0-9a-f]{64}$/,
    );
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Authorization: "Bearer ingest-token" });
  });

  it("displays the store bucket after kill without local kill logic", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bucket: "control", experiment_id: "exp_1", killed: true }),
    });
    globalThis.fetch = fetchMock as typeof fetch;
    setEnv({
      NEXT_PUBLIC_VIBEWARE_EXPERIMENT_ID: "exp_1",
      NEXT_PUBLIC_VIBEWARE_INGEST_URL: "https://store.example/v1/evidence",
      NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN: "ingest-token",
    });
    await expect(fetchAssignment()).resolves.toEqual({ bucket: "control" });
  });

  it("fails closed to control on network, HTTP, and malformed responses", async () => {
    setEnv({
      NEXT_PUBLIC_VIBEWARE_EXPERIMENT_ID: "exp_1",
      NEXT_PUBLIC_VIBEWARE_INGEST_URL: "https://store.example/v1/evidence",
      NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN: "ingest-token",
    });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as typeof fetch;
    await expect(fetchAssignment()).resolves.toEqual(CONTROL_ASSIGNMENT);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ reason: "unauthorized" }),
    }) as typeof fetch;
    await expect(fetchAssignment()).resolves.toEqual(CONTROL_ASSIGNMENT);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    }) as typeof fetch;
    await expect(fetchAssignment()).resolves.toEqual(CONTROL_ASSIGNMENT);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bucket: "other" }),
    }) as typeof fetch;
    await expect(fetchAssignment()).resolves.toEqual(CONTROL_ASSIGNMENT);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => null,
    }) as typeof fetch;
    await expect(fetchAssignment()).resolves.toEqual(CONTROL_ASSIGNMENT);
  });

  it("does not import the collector or mention dashboard or internal tokens", () => {
    expect(SOURCE).not.toContain("collector");
    expect(SOURCE).not.toContain("DASHBOARD");
    expect(SOURCE).not.toContain("INTERNAL");
    expect(SOURCE).toContain("NEXT_PUBLIC_VIBEWARE_INGEST_TOKEN");
    expect(SOURCE).toContain("./cohort");
  });
});
