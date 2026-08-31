import { getRingCallbackUrl } from "@/lib/app-origin";
import { hexToBytes, isEvenHex, zeroizeBytes } from "@/lib/hex";
import { isValidPubky } from "@/utils/pubkyId";
import { RING_GRANT_CAPABILITIES } from "@/types/link";
import { KeyStore, type AppCert } from "@/services/KeyStore";
import { verifyHandoffAppCert } from "@/services/appCertVerify";
import { PaykitLinkWeb } from "@/services/link/PaykitLinkWeb";
import { pollLink, postLink, RelayPollExhaustedError } from "@/services/relayChannel";
import { deriveRingCallbackChannelId } from "@/services/ringChannelId";
import { useAuthStore } from "@/stores/authStore";

export const HANDOFF_TTL_MS = 5 * 60 * 1000;
export const HANDOFF_PATH_PREFIX = "/pub/paykit.app/v0/handoff/";

export type PaykitConnectStart = {
  url: string;
  ch: string;
  deviceId: string;
  deadlineMs: number;
  ephemeralPkHex: string;
};

export type HandoffPublicParams = {
  pubky: string;
  requestId: string;
  mode: string;
  homeserver: string;
};

export type HandoffPayload = {
  version: number;
  pubky: string;
  capabilities?: string[];
  device_id?: string;
  noise_keypairs: Array<{
    epoch: number;
    public_key: string;
    secret_key: string;
  }>;
  noise_seed?: string;
  inbox_keypair: {
    public_key: string;
    secret_key: string;
  };
  app_key?: {
    ed25519_sk: string;
    ed25519_pk: string;
    cert_id: string;
    cert_body: string;
    cert_sig: string;
  };
  created_at?: number;
  expires_at: number;
};

export function buildPaykitConnectUrl(input: {
  deviceId: string;
  ephemeralPkHex: string;
  callbackUrl: string;
}): string {
  const callback = encodeURIComponent(input.callbackUrl);
  return (
    `pubkyring://paykit-connect` +
    `?deviceId=${encodeURIComponent(input.deviceId)}` +
    `&callback=${callback}` +
    `&ephemeralPk=${encodeURIComponent(input.ephemeralPkHex)}` +
    `&caps=${encodeURIComponent(RING_GRANT_CAPABILITIES)}`
  );
}

export function validateHandoffPublicParams(
  value: unknown,
): HandoffPublicParams | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const pubky = typeof record.pubky === "string" ? record.pubky : "";
  const requestId =
    typeof record.request_id === "string"
      ? record.request_id
      : typeof record.requestId === "string"
        ? record.requestId
        : "";
  const mode = typeof record.mode === "string" ? record.mode : "";
  const homeserver =
    typeof record.homeserver === "string" ? record.homeserver : "";
  if (mode !== "secure_handoff") return null;
  if (!isValidPubky(pubky)) return null;
  if (!isEvenHex(requestId) || requestId.length < 8) return null;
  if (!isValidPubky(homeserver)) return null;
  return { pubky, requestId, mode, homeserver };
}

export function parseRelayHandoffBody(bytes: Uint8Array): HandoffPublicParams | null {
  try {
    const text = new TextDecoder().decode(bytes);
    return validateHandoffPublicParams(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export async function startPaykitConnect(): Promise<PaykitConnectStart> {
  await KeyStore.initKeyStore();
  const pair = await PaykitLinkWeb.x25519GenerateKeypair();
  const pkBytes = hexToBytes(pair.publicKey);
  const ch = await deriveRingCallbackChannelId(pkBytes);
  await KeyStore.setPendingRingHandoff(pair.secretKey, pair.publicKey);
  const deviceId = `hypercolor-web-${Date.now().toString(16)}`;
  const callbackUrl = getRingCallbackUrl(ch);
  const url = buildPaykitConnectUrl({
    deviceId,
    ephemeralPkHex: pair.publicKey,
    callbackUrl,
  });
  return {
    url,
    ch,
    deviceId,
    deadlineMs: Date.now() + HANDOFF_TTL_MS,
    ephemeralPkHex: pair.publicKey,
  };
}

/**
 * Long-poll the relay until a valid public-param set arrives or the
 * handoff TTL expires. Junk is rejected and polling resumes.
 */
export async function waitForHandoffParams(
  ch: string,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<HandoffPublicParams> {
  for (;;) {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) {
      throw new RelayPollExhaustedError("paykit-connect handoff TTL expired");
    }
    const body = await pollLink(ch, { deadlineMs, signal });
    const params = parseRelayHandoffBody(body);
    if (params) return params;
  }
}

export async function publishHandoffParamsToRelay(
  ch: string,
  params: HandoffPublicParams,
): Promise<void> {
  const body = JSON.stringify({
    pubky: params.pubky,
    request_id: params.requestId,
    mode: params.mode,
    homeserver: params.homeserver,
  });
  await postLink(ch, body);
}

export function certFromHandoffAppKey(
  appKey: NonNullable<HandoffPayload["app_key"]>,
): AppCert {
  return {
    certBodyHex: appKey.cert_body,
    sigHex: appKey.cert_sig,
    certIdHex: appKey.cert_id,
  };
}

function assertFiniteExpiresAt(expiresAt: unknown): number {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    throw new Error("Handoff payload is missing a valid expires_at");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const maxExpires = nowSeconds + HANDOFF_TTL_MS / 1000;
  if (expiresAt <= nowSeconds) {
    throw new Error("Handoff payload has expired");
  }
  if (expiresAt > maxExpires) {
    throw new Error("Handoff payload expires_at is outside the allowed window");
  }
  return expiresAt;
}

function assertHandoffPubky(
  payloadPubky: unknown,
  params: HandoffPublicParams,
): string {
  if (payloadPubky !== undefined && payloadPubky !== params.pubky) {
    throw new Error("Handoff payload pubky does not match public params");
  }
  return params.pubky;
}

/**
 * Parse decrypted handoff JSON: drop `session_secret`, require a finite
 * `expires_at` inside `[now+ε, now+HANDOFF_TTL]`, and reject a payload
 * `pubky` that disagrees with the public params. Zeroizes `plaintext`.
 */
export function parseHandoffPlaintext(
  plaintext: Uint8Array,
  params: HandoffPublicParams,
): HandoffPayload {
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  } finally {
    zeroizeBytes(plaintext);
  }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new Error("Handoff payload is not an object");
  }
  const record = decoded as Record<string, unknown>;
  delete record.session_secret;

  const expiresAt = assertFiniteExpiresAt(record.expires_at);
  const pubky = assertHandoffPubky(record.pubky, params);

  if (!record.app_key) {
    throw new Error(
      "pubky-ring handoff does not include an app_key. Ensure pubky-ring supports AppKey delegation (v3 handoff).",
    );
  }

  return {
    ...(record as unknown as HandoffPayload),
    pubky,
    expires_at: expiresAt,
  };
}

export async function pendingChannelMatches(ch: string): Promise<boolean> {
  const pkHex = await KeyStore.getPendingRingHandoffPublicKey();
  if (!pkHex) return false;
  try {
    const derived = await deriveRingCallbackChannelId(hexToBytes(pkHex));
    return derived === ch;
  } catch {
    return false;
  }
}

async function fetchAndDecryptHandoff(
  params: HandoffPublicParams,
  ephemeralSkHex: string,
): Promise<HandoffPayload> {
  const storagePath = `${HANDOFF_PATH_PREFIX}${params.requestId}`;
  const raw = await PaykitLinkWeb.publicGet(params.pubky, storagePath);
  if (!raw) {
    throw new Error(`Handoff not found at ${storagePath}`);
  }
  const parsed = JSON.parse(new TextDecoder().decode(raw)) as { sb2?: unknown };
  if (typeof parsed.sb2 !== "string" || parsed.sb2.length === 0) {
    throw new Error('Handoff response is missing the "sb2" field.');
  }
  const envelope = Uint8Array.from(atob(parsed.sb2), (c) => c.charCodeAt(0));
  const valid = await PaykitLinkWeb.sb2VerifySignature(
    envelope,
    params.pubky,
    storagePath,
  );
  if (!valid) {
    throw new Error(
      "Handoff SB2 signature verification failed — possible tampering.",
    );
  }
  const sk = hexToBytes(ephemeralSkHex);
  let plaintext: Uint8Array;
  try {
    plaintext = await PaykitLinkWeb.sb2Decrypt(
      envelope,
      sk,
      params.pubky,
      storagePath,
    );
  } finally {
    zeroizeBytes(sk);
  }
  return parseHandoffPlaintext(plaintext, params);
}

/**
 * Fetch, verify, decrypt. Does not persist until {@link adoptHandoff}.
 */
export async function decryptPendingHandoff(
  params: HandoffPublicParams,
): Promise<HandoffPayload> {
  const ephemeralSkHex = await KeyStore.getPendingRingHandoff();
  if (!ephemeralSkHex) {
    throw new Error(
      "No pending delegation request. Call startPaykitConnect() before handling the callback.",
    );
  }
  return fetchAndDecryptHandoff(params, ephemeralSkHex);
}

/**
 * Persist UKD/app keys. `session_secret` is discarded — the write credential
 * on web is the pubkyauth cookie, not this bearer.
 */
export async function adoptHandoff(
  params: HandoffPublicParams,
  payload: HandoffPayload,
): Promise<{ pubky: string; homeserver: string }> {
  const pubky = assertHandoffPubky(payload.pubky, params);
  const homeserver = params.homeserver;
  if (!payload.app_key) {
    throw new Error("Handoff is missing app_key");
  }
  const appCert = await verifyHandoffAppCert(pubky, payload.app_key);
  await KeyStore.setPubky(pubky);
  await KeyStore.setHomeserver(homeserver);
  await KeyStore.setAppKeypair({
    secretKey: payload.app_key.ed25519_sk,
    publicKey: payload.app_key.ed25519_pk,
  });
  await KeyStore.setAppCert(appCert);
  await KeyStore.setInboxKeypair({
    secretKey: payload.inbox_keypair.secret_key,
    publicKey: payload.inbox_keypair.public_key,
  });
  const transport = payload.noise_keypairs[0];
  if (transport) {
    await KeyStore.setTransportKeypair({
      secretKey: transport.secret_key,
      publicKey: transport.public_key,
    });
  }
  if (payload.noise_seed) {
    await KeyStore.setNoiseSeed(payload.noise_seed);
  }
  await KeyStore.clearPendingRingHandoff();
  useAuthStore.getState().setAuthenticated(pubky, homeserver);
  return { pubky, homeserver };
}

export async function completeHandoffAfterConfirmation(
  params: HandoffPublicParams,
  confirm: (pubky: string) => Promise<boolean>,
): Promise<{ pubky: string; homeserver: string } | null> {
  const payload = await decryptPendingHandoff(params);
  const pubky = assertHandoffPubky(payload.pubky, params);
  const accepted = await confirm(pubky);
  if (!accepted) return null;
  return adoptHandoff(params, payload);
}
