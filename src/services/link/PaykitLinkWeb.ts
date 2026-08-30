import { loadPaykitWasm } from "@/lib/paykit-wasm";
import type {
  AuthFlowHandle,
  PubkyClient,
  SessionHandle,
} from "paykit-wasm";

export type { AuthFlowHandle, PubkyClient, SessionHandle };

export type X25519KeypairHex = {
  publicKey: string;
  secretKey: string;
};

let client: PubkyClient | null = null;

/**
 * Auth / storage adapter over vendored paykit-wasm.
 *
 * `SessionHandle.exportSession()` is secret-free SessionInfo metadata.
 * It must never be placed in a Cookie header — the homeserver cookie
 * value is `session_secret`, and JS cannot read that HttpOnly cookie.
 */
export async function getPaykitClient(): Promise<PubkyClient> {
  const wasm = await loadPaykitWasm();
  client ??= new wasm.PubkyClient();
  return client;
}

export function resetPaykitClientForTests(): void {
  client = null;
}

export const PaykitLinkWeb = {
  async startAuthFlow(capabilities: string): Promise<AuthFlowHandle> {
    const wasmClient = await getPaykitClient();
    return wasmClient.startAuthFlow(capabilities);
  },

  async awaitAuthApproval(flow: AuthFlowHandle): Promise<SessionHandle> {
    return (await flow.awaitApproval()) as SessionHandle;
  },

  /**
   * Dev/e2e only. Production sign-in is `startAuthFlow`.
   */
  async signinWithSecret(identitySecret: Uint8Array): Promise<SessionHandle> {
    const wasmClient = await getPaykitClient();
    return (await wasmClient.signinWithSecret(identitySecret)) as SessionHandle;
  },

  /**
   * Dev/e2e only. Production sign-up is Ring + pubkyauth.
   */
  async signupWithSecret(
    identitySecret: Uint8Array,
    homeserverZ32: string,
    signupToken?: string | null,
  ): Promise<SessionHandle> {
    const wasmClient = await getPaykitClient();
    return (await wasmClient.signupWithSecret(
      identitySecret,
      homeserverZ32,
      signupToken ?? undefined,
    )) as SessionHandle;
  },

  async restoreSession(exported: string): Promise<SessionHandle> {
    const wasmClient = await getPaykitClient();
    return (await wasmClient.restoreSession(exported)) as SessionHandle;
  },

  async resumeSessionFromCookie(pubky: string): Promise<SessionHandle> {
    const wasmClient = await getPaykitClient();
    return (await wasmClient.resumeSessionFromCookie(pubky)) as SessionHandle;
  },

  /**
   * Authenticated PUT. Path + body only — never a Cookie header, never
   * `exportSession()` as a bearer.
   */
  async putPublic(session: SessionHandle, path: string, body: Uint8Array): Promise<void> {
    await session.putPublic(path, body);
  },

  async deletePublic(session: SessionHandle, path: string): Promise<void> {
    await session.deletePublic(path);
  },

  async publicGet(
    ownerPubky: string,
    path: string,
  ): Promise<Uint8Array | undefined> {
    const wasm = await loadPaykitWasm();
    const wasmClient = await getPaykitClient();
    const result = (await wasm.publicGet(wasmClient, ownerPubky, path)) as
      | Uint8Array
      | undefined;
    return result;
  },

  async signOutSession(session: SessionHandle): Promise<void> {
    const wasm = await loadPaykitWasm();
    await wasm.signOutSession(session);
  },

  async generateNoiseSecretKey(): Promise<Uint8Array> {
    const wasm = await loadPaykitWasm();
    return wasm.generateNoiseSecretKey();
  },

  async noisePublicKeyFromSecret(secret: Uint8Array): Promise<string> {
    const wasm = await loadPaykitWasm();
    return wasm.noisePublicKeyFromSecret(secret);
  },

  async publishReceiverMarker(
    session: SessionHandle,
    receiverPath: string,
    noisePublicKey: string,
    privatePayments: boolean,
    paymentRequests: boolean,
    receipts: boolean,
    outgoingPayments: boolean,
  ): Promise<void> {
    const wasm = await loadPaykitWasm();
    await wasm.publishReceiverMarker(
      session,
      receiverPath,
      noisePublicKey,
      privatePayments,
      paymentRequests,
      receipts,
      outgoingPayments,
    );
  },

  async removeReceiverMarker(
    session: SessionHandle,
    receiverPath: string,
  ): Promise<void> {
    const wasm = await loadPaykitWasm();
    await wasm.removeReceiverMarker(session, receiverPath);
  },

  async x25519GenerateKeypair(): Promise<X25519KeypairHex> {
    const wasm = await loadPaykitWasm();
    const pair = wasm.x25519GenerateKeypair() as X25519KeypairHex;
    if (
      typeof pair?.publicKey !== "string" ||
      typeof pair?.secretKey !== "string"
    ) {
      throw new Error("x25519GenerateKeypair: unexpected wasm return shape");
    }
    return pair;
  },

  async sb2VerifySignature(
    envelope: Uint8Array,
    ownerPubky: string,
    canonicalPath: string,
  ): Promise<boolean> {
    const wasm = await loadPaykitWasm();
    return wasm.sb2VerifySignature(envelope, ownerPubky, canonicalPath);
  },

  async sb2Decrypt(
    envelope: Uint8Array,
    recipientSk: Uint8Array,
    ownerPubky: string,
    canonicalPath: string,
  ): Promise<Uint8Array> {
    const wasm = await loadPaykitWasm();
    return wasm.sb2Decrypt(envelope, recipientSk, ownerPubky, canonicalPath);
  },
};
