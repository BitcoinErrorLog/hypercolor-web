/**
 * Test-only UKD AppCert issuance.
 *
 * `issue_app_cert` is not exported from paykit-wasm. This matches
 * `pubky-crypto` `ukd::issue_app_cert`: deterministic CBOR cert_body,
 * Ed25519 over SHA-256(cert_body), cert_id = first 16 bytes of that hash.
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { bytesToHex, hexToBytes } from "@/lib/hex";

const APP_CERT_VERSION = 1;
const ED25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const ED25519_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

export type IssuedAppCert = {
  certBodyHex: string;
  sigHex: string;
  certIdHex: string;
};

export type AppCertInput = {
  rootSecret: Uint8Array;
  issuerPeerid: Uint8Array;
  appId: string;
  appEd25519Pub: Uint8Array;
  transportX25519Pub: Uint8Array;
  inboxX25519Pub: Uint8Array;
};

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function cborUint(n: number): Uint8Array {
  if (n < 24) return Uint8Array.of(n);
  if (n <= 0xff) return Uint8Array.of(0x18, n);
  if (n <= 0xffff) return Uint8Array.of(0x19, (n >> 8) & 0xff, n & 0xff);
  return Uint8Array.of(0x1a, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function cborBytes(data: Uint8Array): Uint8Array {
  const len = data.length;
  const header =
    len < 24
      ? Uint8Array.of(0x40 | len)
      : len <= 0xff
        ? Uint8Array.of(0x58, len)
        : Uint8Array.of(0x59, (len >> 8) & 0xff, len & 0xff);
  return concat(header, data);
}

function cborText(s: string): Uint8Array {
  const data = new TextEncoder().encode(s);
  const len = data.length;
  const header =
    len < 24
      ? Uint8Array.of(0x60 | len)
      : len <= 0xff
        ? Uint8Array.of(0x78, len)
        : Uint8Array.of(0x79, (len >> 8) & 0xff, len & 0xff);
  return concat(header, data);
}

function encodeCertBody(input: AppCertInput): Uint8Array {
  if (!input.appId || input.appId.length > 64) {
    throw new Error("app-cert: app_id must be 1-64 bytes");
  }
  for (const [name, bytes] of [
    ["issuer_peerid", input.issuerPeerid],
    ["app_ed25519_pub", input.appEd25519Pub],
    ["transport_x25519_pub", input.transportX25519Pub],
    ["inbox_x25519_pub", input.inboxX25519Pub],
  ] as const) {
    if (bytes.length !== 32) throw new Error(`app-cert: ${name} must be 32 bytes`);
  }
  return concat(
    Uint8Array.of(0xa6),
    cborUint(0),
    cborUint(APP_CERT_VERSION),
    cborUint(1),
    cborBytes(input.issuerPeerid),
    cborUint(2),
    cborText(input.appId),
    cborUint(4),
    cborBytes(input.appEd25519Pub),
    cborUint(5),
    cborBytes(input.transportX25519Pub),
    cborUint(6),
    cborBytes(input.inboxX25519Pub),
  );
}

function ed25519PrivateKey(secret: Uint8Array) {
  if (secret.length !== 32) throw new Error("app-cert: root secret must be 32 bytes");
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, secret]),
    format: "der",
    type: "pkcs8",
  });
}

function ed25519PublicKey(publicKey: Uint8Array) {
  if (publicKey.length !== 32) throw new Error("app-cert: issuer public key must be 32 bytes");
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
    format: "der",
    type: "spki",
  });
}

export function issueAppCert(input: AppCertInput): IssuedAppCert {
  const certBody = encodeCertBody(input);
  const hash = createHash("sha256").update(certBody).digest();
  const sig = new Uint8Array(sign(null, hash, ed25519PrivateKey(input.rootSecret)));
  return {
    certBodyHex: bytesToHex(certBody),
    sigHex: bytesToHex(sig),
    certIdHex: bytesToHex(hash.subarray(0, 16)),
  };
}

export function verifyAppCert(
  issuerPeerid: Uint8Array,
  cert: IssuedAppCert,
): boolean {
  const body = hexToBytes(cert.certBodyHex);
  const hash = createHash("sha256").update(body).digest();
  if (bytesToHex(hash.subarray(0, 16)) !== cert.certIdHex) return false;
  return verify(null, hash, ed25519PublicKey(issuerPeerid), hexToBytes(cert.sigHex));
}
