import { afterEach, describe, expect, it, vi } from "vitest";
import { RING_GRANT_CAPABILITIES } from "@/types/link";
import { DEFAULT_APP_ORIGIN } from "@/lib/app-origin";
import { setRelayFetchForTests } from "./relayChannel";
import { PaykitLinkWeb } from "./link/PaykitLinkWeb";
import {
  HANDOFF_TTL_MS,
  buildPaykitConnectUrl,
  fetchHandoffBytes,
  parseHandoffPlaintext,
  parseRelayHandoffBody,
  sanitizeHandoffError,
  setHandoffFetchForTests,
  validateHandoffPublicParams,
  waitForHandoffParams,
} from "./RingConnect";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";

describe("RingConnect URL and params", () => {
  afterEach(() => {
    setRelayFetchForTests(null);
  });

  it("builds paykit-connect with encoded https callback carrying ch", () => {
    const callbackUrl = `${DEFAULT_APP_ORIGIN}/ring-callback?ch=abc`;
    const url = buildPaykitConnectUrl({
      deviceId: "hypercolor-web-1",
      ephemeralPkHex: "aa".repeat(32),
      callbackUrl,
    });
    expect(url.startsWith("pubkyring://paykit-connect?")).toBe(true);
    const parsed = new URL(url.replace("pubkyring://", "https://ring/"));
    expect(parsed.searchParams.get("deviceId")).toBe("hypercolor-web-1");
    expect(parsed.searchParams.get("ephemeralPk")).toBe("aa".repeat(32));
    expect(parsed.searchParams.get("caps")).toBe(RING_GRANT_CAPABILITIES);
    expect(parsed.searchParams.get("callback")).toBe(callbackUrl);
  });

  it("accepts the public param set Ring emits and rejects junk", () => {
    const valid = {
      pubky: OWNER,
      request_id: "ab".repeat(32),
      mode: "secure_handoff",
      homeserver: HOMESERVER,
    };
    expect(validateHandoffPublicParams(valid)).toEqual({
      pubky: OWNER,
      requestId: "ab".repeat(32),
      mode: "secure_handoff",
      homeserver: HOMESERVER,
    });
    expect(validateHandoffPublicParams({ ...valid, mode: "plain" })).toBeNull();
    expect(validateHandoffPublicParams({ ...valid, pubky: "not-a-key" })).toBeNull();
    expect(validateHandoffPublicParams({ ...valid, request_id: "zzz" })).toBeNull();
    expect(
      parseRelayHandoffBody(new TextEncoder().encode("not-json")),
    ).toBeNull();
    expect(
      parseRelayHandoffBody(new TextEncoder().encode(JSON.stringify(valid))),
    ).not.toBeNull();
  });

  it("rejects junk on the channel and completes on the next valid message", async () => {
    const valid = {
      pubky: OWNER,
      request_id: "ab".repeat(32),
      mode: "secure_handoff",
      homeserver: HOMESERVER,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("not-json").buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          new TextEncoder().encode(JSON.stringify(valid)).buffer,
      });
    setRelayFetchForTests(fetchMock as unknown as typeof fetch);
    const params = await waitForHandoffParams("abc", Date.now() + 5_000);
    expect(params.pubky).toBe(OWNER);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchHandoffBytes", () => {
  afterEach(() => {
    setHandoffFetchForTests(null);
    vi.restoreAllMocks();
  });

  it("retries a not-found and succeeds on the second attempt", async () => {
    const body = new Uint8Array([1, 2, 3]);
    const publicGet = vi
      .spyOn(PaykitLinkWeb, "publicGet")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(body);
    setHandoffFetchForTests({ sleep: async () => undefined });
    await expect(fetchHandoffBytes(OWNER, "/pub/paykit.app/v0/handoff/ab")).resolves.toEqual(
      body,
    );
    expect(publicGet).toHaveBeenCalledTimes(2);
  });

  it("surfaces a timeout after the bounded attempts", async () => {
    vi.spyOn(PaykitLinkWeb, "publicGet").mockImplementation(
      () => new Promise(() => undefined),
    );
    setHandoffFetchForTests({ sleep: async () => undefined, timeoutMs: 5 });
    await expect(fetchHandoffBytes(OWNER, "/pub/paykit.app/v0/handoff/ab")).rejects.toThrow(
      "Handoff fetch timed out",
    );
    expect(sanitizeHandoffError(new Error("Handoff fetch timed out"))).toBe("network error");
  });

  it("does not retry decrypt or auth failures", async () => {
    const publicGet = vi
      .spyOn(PaykitLinkWeb, "publicGet")
      .mockRejectedValue(Object.assign(new Error("box open failed"), { name: "AuthError" }));
    setHandoffFetchForTests({ sleep: async () => undefined });
    await expect(fetchHandoffBytes(OWNER, "/pub/paykit.app/v0/handoff/ab")).rejects.toThrow(
      "box open failed",
    );
    expect(publicGet).toHaveBeenCalledTimes(1);
  });
});

describe("parseHandoffPlaintext", () => {
  const params = {
    pubky: OWNER,
    requestId: "ab".repeat(32),
    mode: "secure_handoff",
    homeserver: HOMESERVER,
  };

  function encodePayload(overrides: Record<string, unknown> = {}): Uint8Array {
    return new TextEncoder().encode(
      JSON.stringify({
        version: 3,
        pubky: OWNER,
        session_secret: "bearer-must-not-survive",
        noise_keypairs: [{ epoch: 0, public_key: "tpk", secret_key: "tsk" }],
        inbox_keypair: { public_key: "ipk", secret_key: "isk" },
        app_key: {
          ed25519_sk: "ask",
          ed25519_pk: "apk",
          cert_id: "cid",
          cert_body: "cbody",
          cert_sig: "csig",
        },
        expires_at: Math.floor(Date.now() / 1000) + 60,
        ...overrides,
      }),
    );
  }

  it("drops session_secret, zeroizes plaintext, and returns the validated pubky", () => {
    const plaintext = encodePayload();
    const payload = parseHandoffPlaintext(plaintext, params);
    expect(payload).not.toHaveProperty("session_secret");
    expect(payload.pubky).toBe(OWNER);
    expect(plaintext.every((b) => b === 0)).toBe(true);
  });

  it("accepts a payload that omits pubky and adopts the public-params pubky", () => {
    const body = JSON.parse(new TextDecoder().decode(encodePayload())) as Record<
      string,
      unknown
    >;
    delete body.pubky;
    const plaintext = new TextEncoder().encode(JSON.stringify(body));
    const payload = parseHandoffPlaintext(plaintext, params);
    expect(payload.pubky).toBe(OWNER);
  });

  it("rejects a payload pubky that does not match public params", () => {
    const plaintext = encodePayload({ pubky: HOMESERVER });
    expect(() => parseHandoffPlaintext(plaintext, params)).toThrow(
      "Handoff payload pubky does not match public params",
    );
    expect(plaintext.every((b) => b === 0)).toBe(true);
  });

  it("rejects a missing expires_at", () => {
    const body = JSON.parse(new TextDecoder().decode(encodePayload())) as Record<
      string,
      unknown
    >;
    delete body.expires_at;
    const plaintext = new TextEncoder().encode(JSON.stringify(body));
    expect(() => parseHandoffPlaintext(plaintext, params)).toThrow(
      "Handoff payload is missing a valid expires_at",
    );
  });

  it("rejects a non-finite expires_at", () => {
    expect(() =>
      parseHandoffPlaintext(encodePayload({ expires_at: Number.NaN }), params),
    ).toThrow("Handoff payload is missing a valid expires_at");
    expect(() =>
      parseHandoffPlaintext(
        encodePayload({ expires_at: Number.POSITIVE_INFINITY }),
        params,
      ),
    ).toThrow("Handoff payload is missing a valid expires_at");
  });

  it("rejects an already-expired expires_at", () => {
    const plaintext = encodePayload({
      expires_at: Math.floor(Date.now() / 1000) - 1,
    });
    expect(() => parseHandoffPlaintext(plaintext, params)).toThrow(
      "Handoff payload has expired",
    );
  });

  it("rejects an expires_at outside the handoff TTL window", () => {
    const plaintext = encodePayload({
      expires_at: Math.floor(Date.now() / 1000) + HANDOFF_TTL_MS / 1000 + 1,
    });
    expect(() => parseHandoffPlaintext(plaintext, params)).toThrow(
      "Handoff payload expires_at is outside the allowed window",
    );
  });
});
