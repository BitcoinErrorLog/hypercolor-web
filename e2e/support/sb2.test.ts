import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "../../src/lib/hex";
import { asX25519HexPair, loadPaykitWasmNode, type PaykitWasmNode } from "./paykit-wasm-node";

function generateEd25519(): { secret: Uint8Array; publicKey: Uint8Array; hex: string } {
  const pair = generateKeyPairSync("ed25519");
  const pkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" });
  const spki = pair.publicKey.export({ format: "der", type: "spki" });
  const secret = new Uint8Array(pkcs8.subarray(pkcs8.length - 32));
  const publicKey = new Uint8Array(spki.subarray(spki.length - 32));
  return { secret, publicKey, hex: bytesToHex(publicKey) };
}

class CborReader {
  constructor(
    private readonly data: Uint8Array,
    private pos = 0,
  ) {}

  private take(n: number): Uint8Array {
    if (this.pos + n > this.data.length) throw new Error("sb2 header: truncated CBOR");
    const slice = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  private readLength(additional: number): number {
    if (additional < 24) return additional;
    if (additional === 24) return this.take(1)[0]!;
    if (additional === 25) {
      const b = this.take(2);
      return (b[0]! << 8) | b[1]!;
    }
    if (additional === 26) {
      const b = this.take(4);
      return (b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!;
    }
    throw new Error("sb2 header: unsupported CBOR length");
  }

  readMapSize(): number {
    const first = this.take(1)[0]!;
    if ((first >> 5) !== 5) throw new Error("sb2 header: expected map");
    return this.readLength(first & 0x1f);
  }

  readUint(): number {
    const first = this.take(1)[0]!;
    if ((first >> 5) !== 0) throw new Error("sb2 header: expected uint");
    return this.readLength(first & 0x1f);
  }

  readBytes(): Uint8Array {
    const first = this.take(1)[0]!;
    if ((first >> 5) !== 2) throw new Error("sb2 header: expected bstr");
    return this.take(this.readLength(first & 0x1f));
  }

  readText(): string {
    const first = this.take(1)[0]!;
    if ((first >> 5) !== 3) throw new Error("sb2 header: expected tstr");
    return new TextDecoder().decode(this.take(this.readLength(first & 0x1f)));
  }
}

type DecodedHeader = {
  contextId: Uint8Array;
  createdAt?: number;
  expiresAt?: number;
  inboxKid: Uint8Array;
  msgId?: string;
  nonce: Uint8Array;
  purpose?: string;
  recipientPeerid: Uint8Array;
  senderEphemeralPub: Uint8Array;
  senderPeerid: Uint8Array;
  sig?: Uint8Array;
};

function decodeSb2Header(envelope: Uint8Array): DecodedHeader {
  if (envelope.length < 6) throw new Error("sb2: envelope shorter than prefix");
  if (new TextDecoder().decode(envelope.subarray(0, 3)) !== "SB2") {
    throw new Error("sb2: missing magic");
  }
  const headerLen = (envelope[4]! << 8) | envelope[5]!;
  const header = envelope.subarray(6, 6 + headerLen);
  const r = new CborReader(header);
  const n = r.readMapSize();
  const out: Partial<DecodedHeader> = {};
  for (let i = 0; i < n; i += 1) {
    const key = r.readUint();
    if (key === 0) out.contextId = r.readBytes();
    else if (key === 1) out.createdAt = r.readUint();
    else if (key === 2) out.expiresAt = r.readUint();
    else if (key === 3) out.inboxKid = r.readBytes();
    else if (key === 4) out.msgId = r.readText();
    else if (key === 5) out.nonce = r.readBytes();
    else if (key === 6) out.purpose = r.readText();
    else if (key === 7) out.recipientPeerid = r.readBytes();
    else if (key === 8) out.senderEphemeralPub = r.readBytes();
    else if (key === 9) out.senderPeerid = r.readBytes();
    else if (key === 10) out.sig = r.readBytes();
    else if (key === 11) r.readBytes();
    else throw new Error(`sb2 header: unexpected key ${key}`);
  }
  if (!out.contextId || !out.inboxKid || !out.nonce || !out.recipientPeerid || !out.senderEphemeralPub || !out.senderPeerid) {
    throw new Error("sb2 header: missing required fields");
  }
  return out as DecodedHeader;
}

function encryptSigned(
  wasm: PaykitWasmNode,
  input: {
    recipientPk: Uint8Array;
    plaintext: Uint8Array;
    ownerHex: string;
    senderHex: string;
    recipientPeerHex: string;
    senderSecret: Uint8Array;
    path: string;
    createdAt: bigint;
    expiresAt: bigint;
    msgId: string;
  },
): Uint8Array {
  const unsigned = wasm.sb2Encrypt(
    input.recipientPk,
    input.plaintext,
    crypto.getRandomValues(new Uint8Array(32)),
    input.msgId,
    "handoff",
    input.ownerHex,
    input.senderHex,
    input.recipientPeerHex,
    input.path,
    input.createdAt,
    input.expiresAt,
  );
  return wasm.sb2Sign(unsigned, input.senderSecret, input.ownerHex, input.path);
}

describe("paykit-wasm sb2Encrypt/sb2Sign", () => {
  it("round-trips with three distinct owner/sender/recipient peerids", async () => {
    const wasm = await loadPaykitWasmNode();
    const recipient = asX25519HexPair(wasm.x25519GenerateKeypair());
    const owner = generateEd25519();
    const sender = generateEd25519();
    const recipientPeer = generateEd25519();
    expect(owner.hex).not.toBe(sender.hex);
    expect(sender.hex).not.toBe(recipientPeer.hex);
    expect(owner.hex).not.toBe(recipientPeer.hex);

    const plaintext = new TextEncoder().encode(JSON.stringify({ version: 3, ok: true }));
    const path = `/pub/paykit.app/v0/handoff/${"ab".repeat(32)}`;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const envelope = encryptSigned(wasm, {
      recipientPk: hexToBytes(recipient.publicKey),
      plaintext,
      ownerHex: owner.hex,
      senderHex: sender.hex,
      recipientPeerHex: recipientPeer.hex,
      senderSecret: sender.secret,
      path,
      createdAt: now,
      expiresAt: now + 240n,
      msgId: "handoff-distinct",
    });

    const header = decodeSb2Header(envelope);
    expect(bytesToHex(header.senderPeerid)).toBe(sender.hex);
    expect(bytesToHex(header.recipientPeerid)).toBe(recipientPeer.hex);
    expect(bytesToHex(header.senderPeerid)).not.toBe(owner.hex);
    expect(bytesToHex(header.recipientPeerid)).not.toBe(owner.hex);
    expect(bytesToHex(header.inboxKid)).toBe(wasm.computeInboxKid(recipient.publicKey));
    expect(header.msgId).toBe("handoff-distinct");
    expect(header.purpose).toBe("handoff");

    expect(wasm.sb2VerifySignature(envelope, owner.hex, path)).toBe(true);
    expect(() => wasm.sb2VerifySignature(envelope, sender.hex, path)).toThrow();
    expect(() => wasm.sb2VerifySignature(envelope, recipientPeer.hex, path)).toThrow();
    const opened = wasm.sb2Decrypt(envelope, hexToBytes(recipient.secretKey), owner.hex, path);
    expect(new TextDecoder().decode(opened)).toBe(new TextDecoder().decode(plaintext));
  });

  it("returns false when the envelope has no signature (Rust semantics)", async () => {
    const wasm = await loadPaykitWasmNode();
    const recipient = asX25519HexPair(wasm.x25519GenerateKeypair());
    const owner = generateEd25519();
    const path = "/pub/paykit.app/v0/handoff/unsigned";
    const now = BigInt(Math.floor(Date.now() / 1000));
    const unsigned = wasm.sb2Encrypt(
      hexToBytes(recipient.publicKey),
      new TextEncoder().encode("unsigned"),
      crypto.getRandomValues(new Uint8Array(32)),
      "handoff-unsigned",
      "handoff",
      owner.hex,
      owner.hex,
      owner.hex,
      path,
      now,
      now + 60n,
    );
    expect(decodeSb2Header(unsigned).sig).toBeUndefined();
    expect(wasm.sb2VerifySignature(unsigned, owner.hex, path)).toBe(false);
    expect(
      new TextDecoder().decode(
        wasm.sb2Decrypt(unsigned, hexToBytes(recipient.secretKey), owner.hex, path),
      ),
    ).toBe("unsigned");
  });

  it("rejects a truncated envelope", async () => {
    const wasm = await loadPaykitWasmNode();
    const recipient = asX25519HexPair(wasm.x25519GenerateKeypair());
    const owner = generateEd25519();
    const path = "/pub/paykit.app/v0/handoff/trunc";
    const now = BigInt(Math.floor(Date.now() / 1000));
    const envelope = encryptSigned(wasm, {
      recipientPk: hexToBytes(recipient.publicKey),
      plaintext: new TextEncoder().encode("full"),
      ownerHex: owner.hex,
      senderHex: owner.hex,
      recipientPeerHex: owner.hex,
      senderSecret: owner.secret,
      path,
      createdAt: now,
      expiresAt: now + 60n,
      msgId: "handoff-trunc",
    });
    const truncated = envelope.subarray(0, 10);
    expect(() => wasm.sb2VerifySignature(truncated, owner.hex, path)).toThrow();
    expect(() =>
      wasm.sb2Decrypt(truncated, hexToBytes(recipient.secretKey), owner.hex, path),
    ).toThrow();
  });

  it("rejects a tampered header field", async () => {
    const wasm = await loadPaykitWasmNode();
    const recipient = asX25519HexPair(wasm.x25519GenerateKeypair());
    const owner = generateEd25519();
    const path = "/pub/paykit.app/v0/handoff/tamper-header";
    const now = BigInt(Math.floor(Date.now() / 1000));
    const envelope = encryptSigned(wasm, {
      recipientPk: hexToBytes(recipient.publicKey),
      plaintext: new TextEncoder().encode("header-bound"),
      ownerHex: owner.hex,
      senderHex: owner.hex,
      recipientPeerHex: owner.hex,
      senderSecret: owner.secret,
      path,
      createdAt: now,
      expiresAt: now + 60n,
      msgId: "handoff-header",
    });
    const headerLen = (envelope[4]! << 8) | envelope[5]!;
    expect(headerLen).toBeGreaterThan(8);
    const tampered = new Uint8Array(envelope);
    tampered[6 + 4] ^= 0xff;
    expect(() => wasm.sb2VerifySignature(tampered, owner.hex, path)).toThrow();
    expect(() =>
      wasm.sb2Decrypt(tampered, hexToBytes(recipient.secretKey), owner.hex, path),
    ).toThrow();
  });

  it("preserves created_at > expires_at (wasm does not reject inverted timestamps)", async () => {
    const wasm = await loadPaykitWasmNode();
    const recipient = asX25519HexPair(wasm.x25519GenerateKeypair());
    const owner = generateEd25519();
    const path = "/pub/paykit.app/v0/handoff/inverted-ts";
    const createdAt = 2_000n;
    const expiresAt = 1_000n;
    const envelope = encryptSigned(wasm, {
      recipientPk: hexToBytes(recipient.publicKey),
      plaintext: new TextEncoder().encode("inverted"),
      ownerHex: owner.hex,
      senderHex: owner.hex,
      recipientPeerHex: owner.hex,
      senderSecret: owner.secret,
      path,
      createdAt,
      expiresAt,
      msgId: "handoff-inverted",
    });
    const header = decodeSb2Header(envelope);
    expect(header.createdAt).toBe(Number(createdAt));
    expect(header.expiresAt).toBe(Number(expiresAt));
    expect(header.createdAt).toBeGreaterThan(header.expiresAt!);
    expect(wasm.sb2VerifySignature(envelope, owner.hex, path)).toBe(true);
    expect(
      new TextDecoder().decode(
        wasm.sb2Decrypt(envelope, hexToBytes(recipient.secretKey), owner.hex, path),
      ),
    ).toBe("inverted");
  });

  it("is rejected by wasm when the ciphertext is tampered", async () => {
    const wasm = await loadPaykitWasmNode();
    const recipient = asX25519HexPair(wasm.x25519GenerateKeypair());
    const owner = generateEd25519();
    const path = "/pub/paykit.app/v0/handoff/tamper-ct";
    const now = BigInt(Math.floor(Date.now() / 1000));
    const envelope = encryptSigned(wasm, {
      recipientPk: hexToBytes(recipient.publicKey),
      plaintext: new TextEncoder().encode("do not flip"),
      ownerHex: owner.hex,
      senderHex: owner.hex,
      recipientPeerHex: owner.hex,
      senderSecret: owner.secret,
      path,
      createdAt: now,
      expiresAt: now + 60n,
      msgId: "handoff-ct",
    });
    const tampered = new Uint8Array(envelope);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => wasm.sb2VerifySignature(tampered, owner.hex, path)).toThrow();
    expect(() =>
      wasm.sb2Decrypt(tampered, hexToBytes(recipient.secretKey), owner.hex, path),
    ).toThrow();
  });

  it("is rejected by wasm on a wrong canonical path", async () => {
    const wasm = await loadPaykitWasmNode();
    const recipient = asX25519HexPair(wasm.x25519GenerateKeypair());
    const owner = generateEd25519();
    const path = "/pub/paykit.app/v0/handoff/correct";
    const now = BigInt(Math.floor(Date.now() / 1000));
    const envelope = encryptSigned(wasm, {
      recipientPk: hexToBytes(recipient.publicKey),
      plaintext: new TextEncoder().encode("path-bound"),
      ownerHex: owner.hex,
      senderHex: owner.hex,
      recipientPeerHex: owner.hex,
      senderSecret: owner.secret,
      path,
      createdAt: now,
      expiresAt: now + 60n,
      msgId: "handoff-path",
    });
    expect(() => wasm.sb2VerifySignature(envelope, owner.hex, `${path}-tampered`)).toThrow();
    expect(() =>
      wasm.sb2Decrypt(envelope, hexToBytes(recipient.secretKey), owner.hex, `${path}-tampered`),
    ).toThrow();
  });

  it("is rejected by wasm for the wrong recipient key", async () => {
    const wasm = await loadPaykitWasmNode();
    const recipient = asX25519HexPair(wasm.x25519GenerateKeypair());
    const other = asX25519HexPair(wasm.x25519GenerateKeypair());
    const owner = generateEd25519();
    const path = "/pub/paykit.app/v0/handoff/wrong-rk";
    const now = BigInt(Math.floor(Date.now() / 1000));
    const envelope = encryptSigned(wasm, {
      recipientPk: hexToBytes(recipient.publicKey),
      plaintext: new TextEncoder().encode("secret"),
      ownerHex: owner.hex,
      senderHex: owner.hex,
      recipientPeerHex: owner.hex,
      senderSecret: owner.secret,
      path,
      createdAt: now,
      expiresAt: now + 60n,
      msgId: "handoff-rk",
    });
    expect(wasm.sb2VerifySignature(envelope, owner.hex, path)).toBe(true);
    expect(() => wasm.sb2Decrypt(envelope, hexToBytes(other.secretKey), owner.hex, path)).toThrow();
  });

  it("is rejected by wasm for the wrong owner pubkey", async () => {
    const wasm = await loadPaykitWasmNode();
    const recipient = asX25519HexPair(wasm.x25519GenerateKeypair());
    const owner = generateEd25519();
    const other = generateEd25519();
    const path = "/pub/paykit.app/v0/handoff/wrong-owner";
    const now = BigInt(Math.floor(Date.now() / 1000));
    const envelope = encryptSigned(wasm, {
      recipientPk: hexToBytes(recipient.publicKey),
      plaintext: new TextEncoder().encode("owner-bound"),
      ownerHex: owner.hex,
      senderHex: owner.hex,
      recipientPeerHex: owner.hex,
      senderSecret: owner.secret,
      path,
      createdAt: now,
      expiresAt: now + 60n,
      msgId: "handoff-owner",
    });
    expect(() => wasm.sb2VerifySignature(envelope, other.hex, path)).toThrow();
    expect(() =>
      wasm.sb2Decrypt(envelope, hexToBytes(recipient.secretKey), other.hex, path),
    ).toThrow();
  });
});
