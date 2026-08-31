import { Keypair } from "@synonymdev/pubky";
import { bytesToHex, hexToBytes } from "@/lib/hex";
import { issueAppCert, type IssuedAppCert } from "./issue-app-cert";

export type SignedAppCertFixture = {
  ownerPubky: string;
  ownerPeerid: Uint8Array;
  cert: IssuedAppCert;
  appKey: {
    ed25519_sk: string;
    ed25519_pk: string;
    cert_id: string;
    cert_body: string;
    cert_sig: string;
  };
  inboxKeypair: { public_key: string; secret_key: string };
  transportKeypair: { public_key: string; secret_key: string };
  noiseSeed: string;
};

function randomHex(bytes: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function makeSignedAppCert(options?: { appId?: string }): SignedAppCertFixture {
  const root = Keypair.random();
  const app = Keypair.random();
  const ownerPubky = root.publicKey.z32();
  const ownerPeerid = root.publicKey.toUint8Array();
  const rootSecret = new Uint8Array(root.secret());
  const appSecret = new Uint8Array(app.secret());
  const appPub = app.publicKey.toUint8Array();
  const inboxKeypair = { public_key: randomHex(32), secret_key: randomHex(32) };
  const transportKeypair = { public_key: randomHex(32), secret_key: randomHex(32) };
  const cert = issueAppCert({
    rootSecret,
    issuerPeerid: ownerPeerid,
    appId: options?.appId ?? "hypercolor.app",
    appEd25519Pub: appPub,
    transportX25519Pub: hexToBytes(transportKeypair.public_key),
    inboxX25519Pub: hexToBytes(inboxKeypair.public_key),
  });

  return {
    ownerPubky,
    ownerPeerid,
    cert,
    appKey: {
      ed25519_sk: bytesToHex(appSecret),
      ed25519_pk: bytesToHex(appPub),
      cert_id: cert.certIdHex,
      cert_body: cert.certBodyHex,
      cert_sig: cert.sigHex,
    },
    inboxKeypair,
    transportKeypair,
    noiseSeed: randomHex(32),
  };
}
