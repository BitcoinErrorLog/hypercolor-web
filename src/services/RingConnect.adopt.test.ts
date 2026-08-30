import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { KeyStore } from "@/services/KeyStore";
import { adoptHandoff, type HandoffPayload } from "./RingConnect";

const OWNER = "o1ikfer5cy8obp3bp1kqcyd8n4gx3qzzo1ikfer5cy8obp3bp1kq";
const HOMESERVER = "8um71us3fyw6h8wbcxb5ar3rwusy1a6u49ba7eabxpqi8gnetewy";

describe("adoptHandoff", () => {
  beforeEach(async () => {
    await KeyStore.initKeyStore();
    await KeyStore.clear();
  });

  it("stores UKD keys and never writes session_secret", async () => {
    const payload: HandoffPayload = {
      version: 3,
      pubky: OWNER,
      session_secret: "must-not-be-stored",
      noise_keypairs: [
        { epoch: 0, public_key: "tpk", secret_key: "tsk" },
      ],
      noise_seed: "seedhex",
      inbox_keypair: { public_key: "ipk", secret_key: "isk" },
      app_key: {
        ed25519_sk: "ask",
        ed25519_pk: "apk",
        cert_id: "cid",
        cert_body: "cbody",
        cert_sig: "csig",
      },
    };

    await adoptHandoff(
      {
        pubky: OWNER,
        requestId: "ab".repeat(32),
        mode: "secure_handoff",
        homeserver: HOMESERVER,
      },
      payload,
    );

    expect(await KeyStore.getPubky()).toBe(OWNER);
    expect(await KeyStore.getHomeserver()).toBe(HOMESERVER);
    expect(await KeyStore.getAppKeypair()).toEqual({
      secretKey: "ask",
      publicKey: "apk",
    });
    expect(await KeyStore.getSessionSecret()).toBeNull();
    expect(await KeyStore.getNoiseSeed()).toBe("seedhex");
  });
});
