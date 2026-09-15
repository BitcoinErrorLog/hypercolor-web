import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { KeyStore } from "@/services/KeyStore";
import { adoptHandoff, type HandoffPayload } from "./RingConnect";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";

const PARAMS = {
  pubky: OWNER,
  requestId: "ab".repeat(32),
  mode: "secure_handoff",
  homeserver: HOMESERVER,
} as const;

function validPayload(overrides: Partial<HandoffPayload> = {}): HandoffPayload {
  return {
    version: 3,
    pubky: OWNER,
    noise_keypairs: [{ epoch: 0, public_key: "tpk", secret_key: "tsk" }],
    noise_seed: "seedhex",
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
  };
}

describe("adoptHandoff", () => {
  beforeEach(async () => {
    await KeyStore.initKeyStore();
    await KeyStore.clear();
  });

  it("stores UKD keys and never writes session_secret", async () => {
    const payload = {
      ...validPayload(),
      session_secret: "must-not-be-stored",
    } as HandoffPayload & { session_secret: string };

    const result = await adoptHandoff(PARAMS, payload);

    expect(result.pubky).toBe(OWNER);
    expect(await KeyStore.getPubky()).toBe(OWNER);
    expect(await KeyStore.getHomeserver()).toBe(HOMESERVER);
    expect(await KeyStore.getAppKeypair()).toEqual({
      secretKey: "ask",
      publicKey: "apk",
    });
    expect(KeyStore).not.toHaveProperty("setSessionSecret");
    expect(KeyStore).not.toHaveProperty("getSessionSecret");
    expect(await KeyStore.getNoiseSeed()).toBe("seedhex");
  });

  it("rejects a payload pubky that does not match public params", async () => {
    const payload = validPayload({ pubky: HOMESERVER });
    await expect(adoptHandoff(PARAMS, payload)).rejects.toThrow(
      "Handoff payload pubky does not match public params",
    );
    expect(await KeyStore.getPubky()).toBeNull();
    expect(await KeyStore.getAppKeypair()).toBeNull();
  });

  it("adopts the public-params pubky when the payload omits pubky", async () => {
    const payload = validPayload();
    delete (payload as { pubky?: string }).pubky;
    const result = await adoptHandoff(PARAMS, payload);
    expect(result.pubky).toBe(OWNER);
    expect(await KeyStore.getPubky()).toBe(OWNER);
  });
});
