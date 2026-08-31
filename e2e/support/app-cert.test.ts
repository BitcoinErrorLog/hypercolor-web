import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { asX25519HexPair, loadPaykitWasmNode } from "./paykit-wasm-node";
import { issueAppCert, verifyAppCert } from "./app-cert";
import { hexToBytes } from "../../src/lib/hex";

function generateEd25519(): { secret: Uint8Array; publicKey: Uint8Array } {
  const pair = generateKeyPairSync("ed25519");
  const pkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" });
  const spki = pair.publicKey.export({ format: "der", type: "spki" });
  return {
    secret: new Uint8Array(pkcs8.subarray(pkcs8.length - 32)),
    publicKey: new Uint8Array(spki.subarray(spki.length - 32)),
  };
}

describe("issueAppCert", () => {
  it("issues a cert that verifies under the root public key", async () => {
    const wasm = await loadPaykitWasmNode();
    const root = generateEd25519();
    const app = generateEd25519();
    const inbox = asX25519HexPair(wasm.x25519GenerateKeypair());
    const transport = asX25519HexPair(wasm.x25519GenerateKeypair());
    const cert = issueAppCert({
      rootSecret: root.secret,
      issuerPeerid: root.publicKey,
      appId: "hypercolor.app",
      appEd25519Pub: app.publicKey,
      transportX25519Pub: hexToBytes(transport.publicKey),
      inboxX25519Pub: hexToBytes(inbox.publicKey),
    });
    expect(cert.certIdHex).toMatch(/^[0-9a-f]{32}$/);
    expect(cert.sigHex).toMatch(/^[0-9a-f]{128}$/);
    expect(cert.certBodyHex.length).toBeGreaterThan(32);
    expect(verifyAppCert(root.publicKey, cert)).toBe(true);
    expect(verifyAppCert(app.publicKey, cert)).toBe(false);
  });
});
