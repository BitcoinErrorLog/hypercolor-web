import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import init, { sb2Decrypt, sb2VerifySignature, x25519GenerateKeypair } from "paykit-wasm";
import { bytesToHex, hexToBytes, sb2EncryptSigned } from "./sb2";

let wasmReady: Promise<void> | null = null;

async function ensureWasm(): Promise<void> {
  wasmReady ??= (async () => {
    const wasmPath = join(
      dirname(fileURLToPath(import.meta.resolve("paykit-wasm"))),
      "paykit_wasm_bg.wasm",
    );
    await init({ module_or_path: await readFile(wasmPath) });
  })();
  await wasmReady;
}

function generateEd25519(): { secret: Uint8Array; publicKey: Uint8Array } {
  const pair = generateKeyPairSync("ed25519");
  const pkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" });
  const spki = pair.publicKey.export({ format: "der", type: "spki" });
  return {
    secret: new Uint8Array(pkcs8.subarray(pkcs8.length - 32)),
    publicKey: new Uint8Array(spki.subarray(spki.length - 32)),
  };
}

function encryptFixture(recipient: { publicKey: string; secretKey: string }) {
  const sender = generateEd25519();
  const plaintext = new TextEncoder().encode(JSON.stringify({ version: 3, ok: true }));
  const path = `/pub/paykit.app/v0/handoff/${"ab".repeat(32)}`;
  const now = Math.floor(Date.now() / 1000);
  const envelope = sb2EncryptSigned({
    plaintext,
    recipientInboxPk: hexToBytes(recipient.publicKey),
    ownerPeerid: sender.publicKey,
    senderPeerid: sender.publicKey,
    recipientPeerid: sender.publicKey,
    senderEd25519Secret: sender.secret,
    canonicalPath: path,
    contextId: crypto.getRandomValues(new Uint8Array(32)),
    msgId: "handoff-test",
    purpose: "handoff",
    createdAt: now,
    expiresAt: now + 240,
  });
  return {
    envelope,
    ownerHex: bytesToHex(sender.publicKey),
    path,
    plaintext,
    recipientSk: hexToBytes(recipient.secretKey),
  };
}

describe("sb2EncryptSigned", () => {
  it("produces an envelope the real paykit-wasm can verify and decrypt", async () => {
    await ensureWasm();
    const recipient = x25519GenerateKeypair() as { publicKey: string; secretKey: string };
    const { envelope, ownerHex, path, plaintext, recipientSk } = encryptFixture(recipient);
    expect(sb2VerifySignature(envelope, ownerHex, path)).toBe(true);
    const opened = sb2Decrypt(envelope, recipientSk, ownerHex, path);
    expect(new TextDecoder().decode(opened)).toBe(new TextDecoder().decode(plaintext));
  });

  it("is rejected by real paykit-wasm when the ciphertext is tampered", async () => {
    await ensureWasm();
    const recipient = x25519GenerateKeypair() as { publicKey: string; secretKey: string };
    const { envelope, ownerHex, path, recipientSk } = encryptFixture(recipient);
    const tampered = new Uint8Array(envelope);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => sb2VerifySignature(tampered, ownerHex, path)).toThrow();
    expect(() => sb2Decrypt(tampered, recipientSk, ownerHex, path)).toThrow();
  });

  it("is rejected by real paykit-wasm on a wrong canonical path", async () => {
    await ensureWasm();
    const recipient = x25519GenerateKeypair() as { publicKey: string; secretKey: string };
    const { envelope, ownerHex, path, recipientSk } = encryptFixture(recipient);
    const wrongPath = `${path}-tampered`;
    expect(() => sb2VerifySignature(envelope, ownerHex, wrongPath)).toThrow();
    expect(() => sb2Decrypt(envelope, recipientSk, ownerHex, wrongPath)).toThrow();
  });

  it("is rejected by real paykit-wasm for the wrong recipient key", async () => {
    await ensureWasm();
    const recipient = x25519GenerateKeypair() as { publicKey: string; secretKey: string };
    const other = x25519GenerateKeypair() as { publicKey: string; secretKey: string };
    const { envelope, ownerHex, path } = encryptFixture(recipient);
    expect(sb2VerifySignature(envelope, ownerHex, path)).toBe(true);
    expect(() => sb2Decrypt(envelope, hexToBytes(other.secretKey), ownerHex, path)).toThrow();
  });

  it("is rejected by real paykit-wasm for the wrong owner pubkey", async () => {
    await ensureWasm();
    const recipient = x25519GenerateKeypair() as { publicKey: string; secretKey: string };
    const { envelope, path, recipientSk } = encryptFixture(recipient);
    const otherOwner = bytesToHex(generateEd25519().publicKey);
    expect(() => sb2VerifySignature(envelope, otherOwner, path)).toThrow();
    expect(() => sb2Decrypt(envelope, recipientSk, otherOwner, path)).toThrow();
  });
});
