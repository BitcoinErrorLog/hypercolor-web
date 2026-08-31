import { createRequire } from "node:module";
import { join } from "node:path";

// Playwright transpiles e2e TS to CJS (`import.meta` is not available).
const require = createRequire(join(process.cwd(), "e2e/support/load-pubky.ts"));

export type PubkyPublicKey = {
  z32(): string;
  toUint8Array(): Uint8Array;
};

export type PubkyKeypair = {
  secret(): Uint8Array;
  publicKey: PubkyPublicKey;
};

export type PubkySessionStorage = {
  putJson(path: string, body: unknown): Promise<void>;
};

export type PubkySession = {
  storage: PubkySessionStorage;
};

export type PubkySigner = {
  publicKey: PubkyPublicKey;
  signup(homeserver: PubkyPublicKey, signupToken?: string | null): Promise<void>;
  signupCookie(homeserver: PubkyPublicKey, signupToken?: string | null): Promise<PubkySession>;
  signin(clientId: string): Promise<PubkySession>;
  approveAuthRequest(pubkyauthUrl: string): Promise<void>;
  pkdns: {
    publishHomeserverForce(hostOverride?: PubkyPublicKey | null): Promise<void>;
  };
};

export type PubkySdk = {
  Keypair: {
    random(): PubkyKeypair;
    fromSecret(secret: Uint8Array): PubkyKeypair;
  };
  PublicKey: {
    from(value: string): PubkyPublicKey;
  };
  Pubky: new () => {
    signer(keypair: PubkyKeypair): PubkySigner;
    getHomeserverOf(user: PubkyPublicKey): Promise<PubkyPublicKey | undefined>;
    publicStorage: {
      getJson(address: string): Promise<unknown>;
    };
  };
};

let cached: PubkySdk | null = null;

export function loadPubkySdk(): PubkySdk {
  if (cached) return cached;
  cached = require("@synonymdev/pubky") as PubkySdk;
  return cached;
}
