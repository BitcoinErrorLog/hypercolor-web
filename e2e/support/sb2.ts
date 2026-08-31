/**
 * Test-only SB2 encrypt + RootKey sign (PUBKY_CRYPTO_SPEC v2.5 / pubky-crypto).
 * Must match paykit-wasm `sb2Decrypt` + `sb2VerifySignature`.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  sign,
} from "node:crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { blake3 } from "./vendor/noble-hashes/blake3.js";

const SB2_MAGIC = new TextEncoder().encode("SB2");
const SB2_VERSION = 2;
const AAD_PREFIX = new TextEncoder().encode("pubky-envelope/v2:");
const SIG_PREFIX = new TextEncoder().encode("pubky-envelope-sig/v2");
const HKDF_INFO_V2 = new TextEncoder().encode("pubky-envelope/v2");

const X25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);
const X25519_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00,
]);
const ED25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export type Sb2EncryptInput = {
  plaintext: Uint8Array;
  recipientInboxPk: Uint8Array;
  ownerPeerid: Uint8Array;
  senderPeerid: Uint8Array;
  recipientPeerid: Uint8Array;
  senderEd25519Secret: Uint8Array;
  canonicalPath: string;
  contextId: Uint8Array;
  msgId: string;
  purpose: string;
  createdAt: number;
  expiresAt: number;
};

class CborWriter {
  readonly buf: number[] = [];

  writeMap(len: number): void {
    if (len < 24) this.buf.push(0xa0 + len);
    else if (len < 256) {
      this.buf.push(0xb8, len);
    } else {
      this.buf.push(0xb9, (len >> 8) & 0xff, len & 0xff);
    }
  }

  writeUint(val: number): void {
    if (val < 24) this.buf.push(val);
    else if (val < 256) this.buf.push(0x18, val);
    else if (val < 65536) this.buf.push(0x19, (val >> 8) & 0xff, val & 0xff);
    else if (val < 0x100000000) {
      this.buf.push(
        0x1a,
        (val >>> 24) & 0xff,
        (val >>> 16) & 0xff,
        (val >>> 8) & 0xff,
        val & 0xff,
      );
    } else {
      const hi = Math.floor(val / 0x100000000);
      const lo = val >>> 0;
      this.buf.push(
        0x1b,
        (hi >>> 24) & 0xff,
        (hi >>> 16) & 0xff,
        (hi >>> 8) & 0xff,
        hi & 0xff,
        (lo >>> 24) & 0xff,
        (lo >>> 16) & 0xff,
        (lo >>> 8) & 0xff,
        lo & 0xff,
      );
    }
  }

  writeBytes(data: Uint8Array): void {
    const len = data.length;
    if (len < 24) this.buf.push(0x40 + len);
    else if (len < 256) this.buf.push(0x58, len);
    else if (len < 65536) this.buf.push(0x59, (len >> 8) & 0xff, len & 0xff);
    else throw new Error("sb2: CBOR bytes longer than 65535");
    this.buf.push(...data);
  }

  writeStr(s: string): void {
    const data = new TextEncoder().encode(s);
    const len = data.length;
    if (len < 24) this.buf.push(0x60 + len);
    else if (len < 256) this.buf.push(0x78, len);
    else if (len < 65536) this.buf.push(0x79, (len >> 8) & 0xff, len & 0xff);
    else throw new Error("sb2: CBOR string longer than 65535");
    this.buf.push(...data);
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.buf);
  }
}

export function computeInboxKid(inboxPk: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(inboxPk).digest().subarray(0, 16));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function encodeHeader(fields: {
  contextId: Uint8Array;
  createdAt: number;
  expiresAt: number;
  inboxKid: Uint8Array;
  msgId: string;
  nonce: Uint8Array;
  purpose: string;
  recipientPeerid: Uint8Array;
  senderEphemeralPub: Uint8Array;
  senderPeerid: Uint8Array;
  sig?: Uint8Array;
}): Uint8Array {
  const w = new CborWriter();
  const fieldCount = 10 + (fields.sig ? 1 : 0);
  w.writeMap(fieldCount);
  w.writeUint(0);
  w.writeBytes(fields.contextId);
  w.writeUint(1);
  w.writeUint(fields.createdAt);
  w.writeUint(2);
  w.writeUint(fields.expiresAt);
  w.writeUint(3);
  w.writeBytes(fields.inboxKid);
  w.writeUint(4);
  w.writeStr(fields.msgId);
  w.writeUint(5);
  w.writeBytes(fields.nonce);
  w.writeUint(6);
  w.writeStr(fields.purpose);
  w.writeUint(7);
  w.writeBytes(fields.recipientPeerid);
  w.writeUint(8);
  w.writeBytes(fields.senderEphemeralPub);
  w.writeUint(9);
  w.writeBytes(fields.senderPeerid);
  if (fields.sig) {
    w.writeUint(10);
    w.writeBytes(fields.sig);
  }
  return w.toBytes();
}

function buildAad(ownerPeerid: Uint8Array, canonicalPath: string, headerNoSig: Uint8Array): Uint8Array {
  return concat(AAD_PREFIX, ownerPeerid, new TextEncoder().encode(canonicalPath), headerNoSig);
}

function computeSigInput(aad: Uint8Array, headerNoSig: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  return blake3(concat(SIG_PREFIX, aad, headerNoSig, ciphertext));
}

function x25519Shared(secret: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const privateKey = createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, secret]),
    format: "der",
    type: "pkcs8",
  });
  const peer = createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, publicKey]),
    format: "der",
    type: "spki",
  });
  return new Uint8Array(diffieHellman({ privateKey, publicKey: peer }));
}

function generateX25519(): { secret: Uint8Array; publicKey: Uint8Array } {
  const pair = generateKeyPairSync("x25519");
  const pkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" });
  const spki = pair.publicKey.export({ format: "der", type: "spki" });
  return {
    secret: new Uint8Array(pkcs8.subarray(pkcs8.length - 32)),
    publicKey: new Uint8Array(spki.subarray(spki.length - 32)),
  };
}

function deriveSymmetricKey(
  sharedSecret: Uint8Array,
  ephemeralPk: Uint8Array,
  recipientPk: Uint8Array,
): Uint8Array {
  const salt = concat(ephemeralPk, recipientPk);
  return new Uint8Array(hkdfSync("sha256", sharedSecret, salt, HKDF_INFO_V2, 32));
}

function ed25519Sign(secret: Uint8Array, message: Uint8Array): Uint8Array {
  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, secret]),
    format: "der",
    type: "pkcs8",
  });
  return new Uint8Array(sign(null, message, key));
}

function encodeSb2(header: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const out = new Uint8Array(6 + header.length + ciphertext.length);
  out.set(SB2_MAGIC, 0);
  out[3] = SB2_VERSION;
  out[4] = (header.length >> 8) & 0xff;
  out[5] = header.length & 0xff;
  out.set(header, 6);
  out.set(ciphertext, 6 + header.length);
  return out;
}

export function sb2EncryptSigned(input: Sb2EncryptInput): Uint8Array {
  if (input.recipientInboxPk.length !== 32) throw new Error("sb2: recipient inbox pk must be 32 bytes");
  if (input.ownerPeerid.length !== 32) throw new Error("sb2: owner peerid must be 32 bytes");
  if (input.senderPeerid.length !== 32) throw new Error("sb2: sender peerid must be 32 bytes");
  if (input.recipientPeerid.length !== 32) throw new Error("sb2: recipient peerid must be 32 bytes");
  if (input.senderEd25519Secret.length !== 32) throw new Error("sb2: sender secret must be 32 bytes");
  if (input.contextId.length !== 32) throw new Error("sb2: context id must be 32 bytes");

  const ephemeral = generateX25519();
  const shared = x25519Shared(ephemeral.secret, input.recipientInboxPk);
  const key = deriveSymmetricKey(shared, ephemeral.publicKey, input.recipientInboxPk);
  try {
    const nonce = crypto.getRandomValues(new Uint8Array(24));
    const inboxKid = computeInboxKid(input.recipientInboxPk);

    const headerFields = {
      contextId: input.contextId,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      inboxKid,
      msgId: input.msgId,
      nonce,
      purpose: input.purpose,
      recipientPeerid: input.recipientPeerid,
      senderEphemeralPub: ephemeral.publicKey,
      senderPeerid: input.senderPeerid,
    };
    const headerNoSig = encodeHeader(headerFields);
    const aad = buildAad(input.ownerPeerid, input.canonicalPath, headerNoSig);
    const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(input.plaintext);
    const sigInput = computeSigInput(aad, headerNoSig, ciphertext);
    const sig = ed25519Sign(input.senderEd25519Secret, sigInput);
    const header = encodeHeader({ ...headerFields, sig });
    return encodeSb2(header, ciphertext);
  } finally {
    ephemeral.secret.fill(0);
    shared.fill(0);
    key.fill(0);
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function hexToBytes(hex: string): Uint8Array {
  const trimmed = hex.trim().toLowerCase();
  if (trimmed.length % 2 !== 0 || !/^[0-9a-f]*$/.test(trimmed)) {
    throw new Error("hexToBytes: expected even-length hex");
  }
  return Uint8Array.from(Buffer.from(trimmed, "hex"));
}
