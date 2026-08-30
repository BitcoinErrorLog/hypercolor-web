import { PaykitLinkWeb } from "./PaykitLinkWeb";

/** Staging homeserver used by shop.pubky.app / Pubky App staging. */
export const STAGING_HOMESERVER_Z32 =
  "8um71us3fyw6h8wbcxb5ar3rwusy1a6u49ba7eabxpqi8gnetewy";

export const OWNER_ROUNDTRIP_PATH =
  "/pub/hypercolor.app/v1/e2e/owner-roundtrip.json";

export type OwnerRoundtripResult = {
  pubky: string;
  putOk: boolean;
  getOk: boolean;
  deleteOk: boolean;
  gone: boolean;
};

function randomIdentitySecret(): Uint8Array {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  return secret;
}

/**
 * Dev/e2e only: signup with an identity secret on staging, then
 * PUT → public GET → DELETE → public GET 404 under the Hypercolor tree.
 * Never logs the signup token.
 */
export async function runOwnerRoundtrip(
  signupToken: string,
): Promise<OwnerRoundtripResult> {
  const token = signupToken.trim();
  if (!token) {
    throw new Error("runOwnerRoundtrip: signup token is required");
  }
  const secret = randomIdentitySecret();
  let session;
  try {
    session = await PaykitLinkWeb.signupWithSecret(
      secret,
      STAGING_HOMESERVER_Z32,
      token,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "signup failed";
    throw new Error(message.split(token).join("[redacted]"));
  }
  const pubky = session.pubky();
  const body = new TextEncoder().encode(
    JSON.stringify({ ok: true, at: Date.now() }),
  );
  await PaykitLinkWeb.putPublic(session, OWNER_ROUNDTRIP_PATH, body);
  const fetched = await PaykitLinkWeb.publicGet(pubky, OWNER_ROUNDTRIP_PATH);
  const getOk =
    fetched !== undefined &&
    new TextDecoder().decode(fetched) === new TextDecoder().decode(body);
  await PaykitLinkWeb.deletePublic(session, OWNER_ROUNDTRIP_PATH);
  const afterDelete = await PaykitLinkWeb.publicGet(pubky, OWNER_ROUNDTRIP_PATH);
  try {
    await PaykitLinkWeb.signOutSession(session);
  } catch {
    try {
      session.free();
    } catch {
      // already consumed
    }
  }
  return {
    pubky,
    putOk: true,
    getOk,
    deleteOk: true,
    gone: afterDelete === undefined,
  };
}
