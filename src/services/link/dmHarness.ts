import { zeroizeBytes } from "@/lib/hex";
import { KeyStore } from "@/services/KeyStore";
import { LINK_RECEIVER_PATH } from "@/types/link";
import { LinkService } from "./LinkService";
import { PaykitLinkWeb } from "./PaykitLinkWeb";
import { STAGING_HOMESERVER_Z32 } from "./ownerRoundtrip";

export type DmSignupResult = {
  pubky: string;
  receiverPath: string;
};

export type DmProofResult = {
  pubky: string;
  peerPubky: string;
  status: string;
  sentBody: string;
  receivedBodies: string[];
};

function randomIdentitySecret(): Uint8Array {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  return secret;
}

function redactToken(error: unknown, token: string): Error {
  const message = error instanceof Error ? error.message : "signup failed";
  return new Error(message.split(token).join("[redacted]"));
}

/**
 * Dev/e2e only: signup on staging, adopt the session, publish a receiver.
 * Never logs the signup token.
 */
export async function runDmSignup(signupToken: string): Promise<DmSignupResult> {
  const token = signupToken.trim();
  if (!token) throw new Error("runDmSignup: signup token is required");
  await KeyStore.initKeyStore();
  const secret = randomIdentitySecret();
  let session;
  try {
    try {
      session = await PaykitLinkWeb.signupWithSecret(
        secret,
        STAGING_HOMESERVER_Z32,
        token,
      );
    } catch (error) {
      throw redactToken(error, token);
    }
  } finally {
    zeroizeBytes(secret);
  }
  await LinkService.adoptHarnessSession(session);
  const provisioned = await LinkService.provisionHarnessReceiver();
  return {
    pubky: provisioned.pubky,
    receiverPath: provisioned.receiverPath || LINK_RECEIVER_PATH,
  };
}

export async function runDmEnsure(peerPubky: string): Promise<string> {
  return LinkService.ensureLinkWith(peerPubky.trim());
}

export async function runDmSend(peerPubky: string, body: string) {
  return LinkService.sendDm(peerPubky.trim(), body);
}

export async function runDmSync(peers: string[]) {
  return LinkService.syncInbox(peers.map((peer) => peer.trim()));
}

export async function runDmRound(input: {
  peerPubky: string;
  body: string;
}): Promise<DmProofResult> {
  const peer = input.peerPubky.trim();
  const status = await LinkService.ensureLinkWith(peer);
  const sent = await LinkService.sendDm(peer, input.body);
  const received = await LinkService.syncInbox([peer]);
  const owner = (await KeyStore.getPubky()) ?? "";
  return {
    pubky: owner,
    peerPubky: peer,
    status,
    sentBody: sent.body,
    receivedBodies: received.map((row) => row.body),
  };
}
