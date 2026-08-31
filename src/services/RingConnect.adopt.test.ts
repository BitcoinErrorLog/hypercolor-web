import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { KeyStore } from "@/services/KeyStore";
import { verifyAppCert } from "@/test-support/issue-app-cert";
import {
  makeSignedAppCert,
  type SignedAppCertFixture,
} from "@/test-support/signed-app-cert";
import { adoptHandoff, type HandoffPayload } from "./RingConnect";

const HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";

function handoffParams(ownerPubky: string) {
  return {
    pubky: ownerPubky,
    requestId: "ab".repeat(32),
    mode: "secure_handoff" as const,
    homeserver: HOMESERVER,
  };
}

function handoffPayload(
  signed: SignedAppCertFixture,
  overrides: Partial<HandoffPayload> = {},
): HandoffPayload {
  return {
    version: 3,
    pubky: signed.ownerPubky,
    noise_keypairs: [
      {
        epoch: 0,
        public_key: signed.transportKeypair.public_key,
        secret_key: signed.transportKeypair.secret_key,
      },
    ],
    noise_seed: signed.noiseSeed,
    inbox_keypair: signed.inboxKeypair,
    app_key: signed.appKey,
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
    const signed = makeSignedAppCert();
    const params = handoffParams(signed.ownerPubky);
    const payload = {
      ...handoffPayload(signed),
      session_secret: "must-not-be-stored",
    } as HandoffPayload & { session_secret: string };

    const result = await adoptHandoff(params, payload);

    expect(result.pubky).toBe(signed.ownerPubky);
    expect(await KeyStore.getPubky()).toBe(signed.ownerPubky);
    expect(await KeyStore.getHomeserver()).toBe(HOMESERVER);
    expect(await KeyStore.getAppKeypair()).toEqual({
      secretKey: signed.appKey.ed25519_sk,
      publicKey: signed.appKey.ed25519_pk,
    });
    expect(await KeyStore.getAppCert()).toEqual({
      certBodyHex: signed.appKey.cert_body,
      sigHex: signed.appKey.cert_sig,
      certIdHex: signed.appKey.cert_id,
    });
    expect(verifyAppCert(signed.ownerPeerid, signed.cert)).toBe(true);
    expect(await KeyStore.isAppCertValid()).toBe(true);
    expect(KeyStore).not.toHaveProperty("setSessionSecret");
    expect(KeyStore).not.toHaveProperty("getSessionSecret");
    expect(await KeyStore.getNoiseSeed()).toBe(signed.noiseSeed);
  });

  it("rejects an AppCert with an invalid signature", () => {
    const signed = makeSignedAppCert();
    expect(verifyAppCert(signed.ownerPeerid, signed.cert)).toBe(true);
    const tampered = {
      ...signed.cert,
      sigHex: `${signed.cert.sigHex.slice(0, -2)}ff`,
    };
    expect(verifyAppCert(signed.ownerPeerid, tampered)).toBe(false);
  });

  it("rejects a payload pubky that does not match public params", async () => {
    const signed = makeSignedAppCert();
    const params = handoffParams(signed.ownerPubky);
    const payload = handoffPayload(signed, { pubky: HOMESERVER });
    await expect(adoptHandoff(params, payload)).rejects.toThrow(
      "Handoff payload pubky does not match public params",
    );
    expect(await KeyStore.getPubky()).toBeNull();
    expect(await KeyStore.getAppKeypair()).toBeNull();
  });

  it("adopts the public-params pubky when the payload omits pubky", async () => {
    const signed = makeSignedAppCert();
    const params = handoffParams(signed.ownerPubky);
    const payload = handoffPayload(signed);
    delete (payload as { pubky?: string }).pubky;
    const result = await adoptHandoff(params, payload);
    expect(result.pubky).toBe(signed.ownerPubky);
    expect(await KeyStore.getPubky()).toBe(signed.ownerPubky);
  });
});
