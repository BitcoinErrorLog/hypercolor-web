import { zeroizeBytes } from "@/lib/hex";
import { KeyStore } from "@/services/KeyStore";
import { PaykitLinkWeb } from "./PaykitLinkWeb";
import { STAGING_HOMESERVER_Z32 } from "./ownerRoundtrip";
import { adoptLiveHandle } from "./session";

function randomIdentitySecret(): Uint8Array {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  return secret;
}

export function redactSignupToken(error: unknown, token: string): Error {
  const message = error instanceof Error ? error.message : "signup failed";
  return new Error(message.split(token).join("[redacted]"));
}

/**
 * Dev/e2e only: signup on staging and adopt the live session.
 * Never logs the signup token. Identity secret is zeroized after signup.
 */
export async function signupStagingAndAdopt(
  signupToken: string,
): Promise<{ pubky: string }> {
  const token = signupToken.trim();
  if (!token) {
    throw new Error("signupStagingAndAdopt: signup token is required");
  }
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
      throw redactSignupToken(error, token);
    }
  } finally {
    zeroizeBytes(secret);
  }
  const adopted = await adoptLiveHandle(session);
  return { pubky: adopted.pubky };
}
