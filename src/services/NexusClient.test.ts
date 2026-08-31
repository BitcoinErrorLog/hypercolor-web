import { describe, expect, it, vi } from "vitest";
import { createNexusClient } from "./NexusClient";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";

describe("NexusClient", () => {
  it("sends Nexus fetches with no-referrer", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createNexusClient({
      baseUrl: "https://nexus.example",
      fetchFn,
    });
    await client.following(OWNER, { skip: 0, limit: 8 });
    expect(fetchFn.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ referrerPolicy: "no-referrer" }),
    );
  });

  it("rejects graph lists that are not valid pubkys instead of typing them as PubkyKey", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(["../etc/passwd", "not-a-pubky", OWNER]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createNexusClient({
      baseUrl: "https://nexus.example",
      fetchFn,
    });
    const result = await client.following(OWNER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("decode");
  });

  it("accepts a list of valid pubkys", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([OWNER]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createNexusClient({
      baseUrl: "https://nexus.example",
      fetchFn,
    });
    const result = await client.following(OWNER);
    expect(result).toEqual({ ok: true, value: [OWNER] });
  });
});
